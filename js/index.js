// JS binding for tree-sitter-md. web-tree-sitter parses blocks with the grammar in
// tree-sitter-markdown.wasm; this file walks that tree and hands each leaf block to
// the inline resolver in tree-sitter-md.wasm, which has no tree-sitter runtime.
// Offsets are UTF-16 code units, the same units as JS strings.
import { Language, Parser } from 'web-tree-sitter'

/** Record kinds. Records are `[start, end, kind, extra]`. */
export const Kind = Object.freeze({
  Paragraph: 1,
  Heading: 2, // extra: level
  ThematicBreak: 3,
  CodeBlock: 4, // extra: 1 fenced
  BlockQuote: 5,
  List: 6, // extra: 1 ordered
  ListItem: 7,
  Task: 8, // extra: 1 checked
  HtmlBlock: 9,
  Definition: 10,
  Table: 11, // extra: column count in the low byte, then 2 bits per column (0 none, 1 left, 2 center, 3 right)
  Emphasis: 12,
  Strong: 13,
  Strikethrough: 14,
  CodeSpan: 15,
  Link: 16,
  Image: 17,
  HtmlInline: 18,
  HardBreak: 19,
  Frontmatter: 20,
  HeadingMark: 32,
  ListMark: 33,
  QuoteMark: 34,
  FenceMark: 35,
  CodeInfo: 36,
  TaskMark: 37,
  TableDelimiterRow: 38,
  LinkText: 39, // the text of a link or image, inside its brackets
})

/** Capture names of highlight triples `[start, end, capture]`, indexed by capture id. */
export const CAPTURES = Object.freeze([
  null,
  'text.title',
  'punctuation.special',
  'text.literal',
  'punctuation.delimiter',
  'text.uri',
  'text.reference',
  'string.escape',
  'text.emphasis',
  'text.strong',
])

// Leaf kinds understood by tsmd_leaf, matching src/resolver.h.
const PARAGRAPH = 0
const SETEXT = 1
const ATX = 2
const TABLE_LEAF = 3
const NO_INLINE = 0xffffffff
// web-tree-sitter copies each chunk into a 10 KB UTF-16 buffer and truncates the rest.
const CHUNK = 5119

let wasm = null
let language = null
let ids = null

async function readSource(pending, fallback) {
  const source = await pending
  if (source instanceof WebAssembly.Module) return source
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return source
  if (typeof Response !== 'undefined' && source instanceof Response) return source
  const url = source ?? new URL(fallback, import.meta.url)
  if (String(url).startsWith('file:')) {
    const { readFile } = await import('node:fs/promises')
    return readFile(url)
  }
  return fetch(url)
}

async function bytes(source, fallback) {
  const input = await readSource(source, fallback)
  if (typeof Response !== 'undefined' && input instanceof Response) return new Uint8Array(await input.arrayBuffer())
  return input
}

function nodeIds(lang) {
  const id = (name) => lang.idForNodeType(name, true)
  return {
    paragraph: id('paragraph'),
    inline: id('inline'),
    continuation: id('block_continuation'),
    atx: id('atx_heading'),
    setext: id('setext_heading'),
    setextH1: id('setext_h1_underline'),
    table: id('pipe_table'),
    delimiterRow: id('pipe_table_delimiter_row'),
    thematicBreak: id('thematic_break'),
    quote: id('block_quote'),
    quoteMarker: id('block_quote_marker'),
    list: id('list'),
    listItem: id('list_item'),
    markerDot: id('list_marker_dot'),
    markerParen: id('list_marker_parenthesis'),
    taskChecked: id('task_list_marker_checked'),
    taskUnchecked: id('task_list_marker_unchecked'),
    fenced: id('fenced_code_block'),
    fenceContent: id('code_fence_content'),
    fenceDelimiter: id('fenced_code_block_delimiter'),
    info: id('info_string'),
    indented: id('indented_code_block'),
    html: id('html_block'),
    minusMetadata: id('minus_metadata'),
    plusMetadata: id('plus_metadata'),
    atxMarkers: [1, 2, 3, 4, 5, 6].map((level) => id(`atx_h${level}_marker`)),
    listMarkers: ['plus', 'minus', 'star', 'dot', 'parenthesis'].map((name) => id(`list_marker_${name}`)),
  }
}

/**
 * Load both modules once. `inline` is the resolver (tree-sitter-md.wasm); `grammar`
 * is the block grammar (tree-sitter-markdown.wasm) or an already loaded `Language`.
 * Each is a URL, a Response (or a promise of one), bytes or a compiled module.
 */
export async function init({ inline, grammar } = {}) {
  if (wasm) return
  await Parser.init()
  const lang =
    grammar instanceof Language ? grammar : await Language.load(await bytes(grammar, '../tree-sitter-markdown.wasm'))
  const input = await readSource(inline, '../tree-sitter-md.wasm')
  let instance
  if (input instanceof WebAssembly.Module) instance = await WebAssembly.instantiate(input, {})
  else if (typeof Response !== 'undefined' && input instanceof Response)
    instance = (await WebAssembly.instantiateStreaming(input, {})).instance
  else instance = (await WebAssembly.instantiate(input, {})).instance
  language = lang
  ids = nodeIds(lang)
  wasm = instance.exports
}

function write(handle, text) {
  const ptr = wasm.tsmd_input(handle, text.length)
  const view = new Uint16Array(wasm.memory.buffer, ptr, text.length)
  for (let i = 0; i < text.length; i++) view[i] = text.charCodeAt(i)
}

function writeArgs(handle, words) {
  const ptr = wasm.tsmd_args(handle, words.length)
  new Uint32Array(wasm.memory.buffer, ptr, words.length).set(words)
}

function read(handle, count) {
  if (count === 0) return new Uint32Array(0)
  const ptr = wasm.tsmd_out(handle)
  return new Uint32Array(wasm.memory.buffer, ptr, count).slice()
}

function isSpace(code) {
  return code === 32 || code === 9 || code === 13 || code === 10
}

function namedChildOf(node, typeId) {
  for (let i = 0, n = node.namedChildCount; i < n; i++) {
    const child = node.namedChild(i)
    if (child.typeId === typeId) return child
  }
  return null
}

// Node types each walk visits: those it records, plus those it does not descend
// into, so the walk can skip what lies inside them.
const NO_LEAVES = ['fenced_code_block', 'indented_code_block', 'html_block', 'pipe_table', 'atx_heading', 'thematic_break', 'inline']
const EMIT_TYPES = [
  'paragraph', 'atx_heading', 'setext_heading', 'pipe_table', 'fenced_code_block', 'indented_code_block',
  'html_block', 'thematic_break', 'minus_metadata', 'plus_metadata', 'block_quote', 'block_quote_marker',
  'list', 'list_item', 'list_marker_plus', 'list_marker_minus', 'list_marker_star', 'list_marker_dot',
  'list_marker_parenthesis', 'task_list_marker_checked', 'task_list_marker_unchecked',
]
const FOLD_TYPES = ['section', 'fenced_code_block', 'block_quote', 'list_item', 'pipe_table', 'html_block', 'paragraph', 'indented_code_block']
const INJECTION_TYPES = NO_LEAVES
const SCAN_TYPES = ['paragraph', ...NO_LEAVES]

function hasLeaves(node) {
  const id = node.typeId
  return (
    id !== ids.fenced &&
    id !== ids.indented &&
    id !== ids.html &&
    id !== ids.table &&
    id !== ids.atx &&
    id !== ids.thematicBreak &&
    id !== ids.inline
  )
}

// Continuation ranges under a block, in tree order, for the resolver's cache key.
function layout(node, words) {
  for (let i = 0, n = node.namedChildCount; i < n; i++) {
    const child = node.namedChild(i)
    if (child.typeId === ids.continuation) words.push(child.startIndex, child.endIndex)
    else if (child.namedChildCount) layout(child, words)
  }
}

// A LeafShape: block range, inline range and the inline's continuation gaps.
function shape(node, words) {
  const inline = namedChildOf(node, ids.inline)
  if (!inline) {
    words.push(node.startIndex, node.endIndex, NO_INLINE, NO_INLINE, 0)
    return
  }
  const gaps = []
  for (let i = 0, n = inline.namedChildCount; i < n; i++) {
    const child = inline.namedChild(i)
    if (child.typeId === ids.continuation) gaps.push(child.startIndex, child.endIndex)
  }
  words.push(node.startIndex, node.endIndex, inline.startIndex, inline.endIndex, gaps.length / 2, ...gaps)
}

function tableRows(node, words) {
  const rows = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const row = node.namedChild(i)
    if (row.typeId === ids.continuation) continue
    rows.push(row.startIndex, row.endIndex, row.typeId === ids.delimiterRow ? 1 : 0)
  }
  words.push(rows.length / 3, ...rows)
}

export class MarkdownDocument {
  #handle
  #parser
  #tree = null
  // Feeds the parser from the resolver's copy of the text. A JS string edited by
  // concatenation would be flattened, a full copy, on every keystroke.
  #input = (index) => {
    const text = this.#view()
    if (index >= text.length) return ''
    return String.fromCharCode.apply(null, text.subarray(index, Math.min(text.length, index + CHUNK)))
  }

  constructor({ gfm = true } = {}) {
    if (!wasm) throw new Error('tree-sitter-md: call init() first')
    this.#handle = wasm.tsmd_new(gfm ? 1 : 0)
    this.#parser = new Parser()
    this.#parser.setLanguage(language)
  }

  /** Replace the whole text and parse it. */
  setText(text) {
    write(this.#handle, text)
    wasm.tsmd_set_text(this.#handle)
    this.#tree?.delete()
    this.#tree = this.#parser.parse(this.#input)
    this.#scan(0, text.length)
    wasm.tsmd_commit(this.#handle)
  }

  /** Replace `[start, oldEnd)` with `inserted`. */
  edit(start, oldEnd, inserted) {
    const startPosition = this.#point(start)
    const oldEndPosition = this.#point(oldEnd)
    write(this.#handle, inserted)
    wasm.tsmd_edit(this.#handle, start, oldEnd)
    const newEnd = start + inserted.length
    const old = this.#tree
    old.edit({
      startIndex: start,
      oldEndIndex: oldEnd,
      newEndIndex: newEnd,
      startPosition,
      oldEndPosition,
      newEndPosition: this.#point(newEnd),
    })
    this.#tree = this.#parser.parse(this.#input, old)
    const ranges = old.getChangedRanges(this.#tree)
    old.delete()
    for (const range of ranges) wasm.tsmd_forget(this.#handle, range.startIndex, range.endIndex)
    this.#scan(start, newEnd)
    for (const range of ranges) this.#scan(range.startIndex, range.endIndex)
    wasm.tsmd_commit(this.#handle)
  }

  /** An unchanged reparse, for idle time after `setText` (keeps it off the first keystroke). */
  reparse() {
    if (!this.#tree) return
    const old = this.#tree
    this.#tree = this.#parser.parse(this.#input, old)
    old.delete()
  }

  /** Records `[start, end, kind, extra]` for constructs intersecting `[from, to)`. */
  decorations(from, to) {
    this.#decorate(from, to)
    return read(this.#handle, wasm.tsmd_count(this.#handle))
  }

  /** Decorations for rows `[fromRow, toRow)`. */
  decorationsForRows(fromRow, toRow) {
    return this.decorations(this.rowStart(fromRow), this.rowStart(toRow))
  }

  /** `[start, end]` pairs of foldable multi-line blocks intersecting `[from, to)`. */
  folds(from, to) {
    const out = []
    this.#walk(FOLD_TYPES, from, to, (node) => this.#fold(node, out))
    return Uint32Array.from(out)
  }

  /** Highlight captures `[start, end, capture]` for `[from, to)`, sorted; names in `CAPTURES`. */
  highlights(from, to) {
    this.#decorate(from, to)
    return read(this.#handle, wasm.tsmd_highlights(this.#handle))
  }

  /** Fenced code injections: `[contentStart, contentEnd, languageStart, languageEnd]`. */
  injections(from, to) {
    const out = []
    this.#walk(INJECTION_TYPES, from, to, (node) => this.#injection(node, out))
    return Uint32Array.from(out)
  }

  rowStart(row) {
    return wasm.tsmd_row_start(this.#handle, row)
  }

  get lineCount() {
    return wasm.tsmd_line_count(this.#handle)
  }

  dispose() {
    if (this.#handle) wasm.tsmd_free(this.#handle)
    this.#handle = 0
    this.#tree?.delete()
    this.#tree = null
    this.#parser?.delete()
    this.#parser = null
  }

  #view() {
    return new Uint16Array(wasm.memory.buffer, wasm.tsmd_text(this.#handle), wasm.tsmd_length(this.#handle))
  }

  #point(pos) {
    const row = wasm.tsmd_row_of(this.#handle, pos)
    return { row, column: pos - wasm.tsmd_row_start(this.#handle, row) }
  }

  // One C-side walk per call: Node#nextSibling rescans the parent's children, and
  // both first-child seeks in stock tree-sitter miss blocks after blank lines.
  // Nodes arrive in tree order, so everything inside a node the handler does not
  // descend into starts before that node ends.
  #walk(types, from, end, handler) {
    if (!this.#tree || end <= 0) return
    const nodes = this.#tree.rootNode.descendantsOfType(types, this.#point(from), this.#point(end))
    let skipUntil = -1
    for (const node of nodes) {
      if (node.startIndex < skipUntil) continue
      if (!handler(node)) skipUntil = node.endIndex
    }
  }

  #decorate(from, to) {
    wasm.tsmd_reset(this.#handle)
    this.#walk(EMIT_TYPES, from, to, (node) => this.#emit(node))
  }

  // Definitions in paragraphs intersecting [from, to], inclusive of a paragraph starting at `to`.
  #scan(from, to) {
    this.#walk(SCAN_TYPES, from, to + 1, (node) => {
      if (node.typeId !== ids.paragraph) return hasLeaves(node)
      this.#define(node)
      return false
    })
  }

  #define(paragraph) {
    const inline = namedChildOf(paragraph, ids.inline)
    if (!inline) return
    const text = this.#view()
    let at = inline.startIndex
    while (at < text.length && (text[at] === 32 || text[at] === 9)) at++
    if (at >= text.length || text[at] !== 91) return
    const words = []
    shape(paragraph, words)
    writeArgs(this.#handle, words)
    wasm.tsmd_define(this.#handle)
  }

  #record(start, end, kind, extra) {
    wasm.tsmd_record(this.#handle, start, end, kind, extra)
  }

  #leaf(node, kind) {
    const words = [node.startIndex, node.endIndex, 0]
    layout(node, words)
    words[2] = (words.length - 3) / 2
    if (kind === TABLE_LEAF) tableRows(node, words)
    else shape(node, words)
    writeArgs(this.#handle, words)
    wasm.tsmd_leaf(this.#handle, kind)
  }

  #emit(node) {
    const id = node.typeId
    const start = node.startIndex
    const end = node.endIndex
    if (id === ids.paragraph) {
      this.#leaf(node, node.parent?.typeId === ids.setext ? SETEXT : PARAGRAPH)
      return false
    }
    if (id === ids.atx) {
      const marker = node.namedChild(0)
      const level = marker ? ids.atxMarkers.indexOf(marker.typeId) + 1 || 1 : 1
      this.#record(start, end, Kind.Heading, level)
      if (marker) this.#record(marker.startIndex, marker.endIndex, Kind.HeadingMark, level)
      this.#leaf(node, ATX)
      return false
    }
    if (id === ids.setext) {
      let level = 2
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child.typeId === ids.setextH1) level = 1
        if (child.typeId !== ids.paragraph && child.typeId !== ids.continuation)
          this.#record(child.startIndex, child.endIndex, Kind.HeadingMark, level)
      }
      this.#record(start, end, Kind.Heading, level)
      return true
    }
    if (id === ids.table) {
      const delimiter = namedChildOf(node, ids.delimiterRow)
      if (delimiter) this.#record(delimiter.startIndex, delimiter.endIndex, Kind.TableDelimiterRow, 0)
      this.#leaf(node, TABLE_LEAF)
      return false
    }
    if (id === ids.fenced) {
      this.#record(start, end, Kind.CodeBlock, 1)
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child.typeId === ids.info) this.#record(child.startIndex, child.endIndex, Kind.CodeInfo, 0)
        if (child.typeId === ids.fenceDelimiter) this.#record(child.startIndex, child.endIndex, Kind.FenceMark, 0)
      }
      return false
    }
    if (id === ids.indented) return this.#block(start, end, Kind.CodeBlock, 0)
    if (id === ids.html) return this.#block(start, end, Kind.HtmlBlock, 0)
    if (id === ids.thematicBreak) return this.#block(start, end, Kind.ThematicBreak, 0)
    if (id === ids.minusMetadata || id === ids.plusMetadata) return this.#block(start, end, Kind.Frontmatter, 0)
    if (id === ids.quote) {
      this.#record(start, end, Kind.BlockQuote, 0)
      return true
    }
    if (id === ids.quoteMarker) return this.#block(start, end, Kind.QuoteMark, 0)
    if (id === ids.list) {
      const marker = node.namedChild(0)?.namedChild(0)
      const ordered = marker && (marker.typeId === ids.markerDot || marker.typeId === ids.markerParen)
      this.#record(start, end, Kind.List, ordered ? 1 : 0)
      return true
    }
    if (id === ids.listItem) {
      this.#record(start, end, Kind.ListItem, 0)
      return true
    }
    if (ids.listMarkers.includes(id)) return this.#block(start, end, Kind.ListMark, 0)
    if (id === ids.taskChecked || id === ids.taskUnchecked)
      return this.#block(start, end, Kind.Task, id === ids.taskChecked ? 1 : 0)
    return true
  }

  // Records a construct with no children to visit.
  #block(start, end, kind, extra) {
    this.#record(start, end, kind, extra)
    return false
  }

  #fold(node, out) {
    const id = node.typeId
    const text = this.#view()
    let a = node.startIndex
    let b = node.endIndex
    while (a < b && isSpace(text[a])) a++
    while (b > a && isSpace(text[b - 1])) b--
    const foldable =
      node.type === 'section' ||
      id === ids.fenced ||
      id === ids.quote ||
      id === ids.listItem ||
      id === ids.table ||
      id === ids.html
    if (foldable && text.subarray(a, b).includes(10)) out.push(a, b)
    return id !== ids.paragraph && id !== ids.fenced && id !== ids.html && id !== ids.table && id !== ids.indented
  }

  #injection(node, out) {
    if (node.typeId !== ids.fenced) return hasLeaves(node)
    const text = this.#view()
    const info = namedChildOf(node, ids.info)
    const content = namedChildOf(node, ids.fenceContent)
    let a = 0
    let b = 0
    if (info) {
      a = info.startIndex
      const end = info.endIndex
      while (a < end && (text[a] === 32 || text[a] === 9)) a++
      b = a
      while (b < end && !isSpace(text[b])) b++
    }
    if (content) out.push(content.startIndex, content.endIndex, a, b)
    return false
  }
}

/** Bytes of the resolver's wasm linear memory, for memory accounting. */
export function memoryBytes() {
  return wasm ? wasm.memory.buffer.byteLength : 0
}
