// JS binding for tree-sitter-md: a tree-sitter-x extension, one document per MarkdownDocument.
// The resolver runs inside tree-sitter-x's runtime and walks trees in C.
import { Language, Parser, heap, loadExtension } from 'web-tree-sitter'
// Offsets are UTF-16 code units, the same units as JS strings.

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

let wasm = null
let language = null
let initialization = null

async function bytes(pending, fallback) {
  const source = await pending
  if (source instanceof WebAssembly.Module) return source
  if (source instanceof ArrayBuffer) return new Uint8Array(source)
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
  if (typeof Response !== 'undefined' && source instanceof Response) return new Uint8Array(await source.arrayBuffer())
  const url = source ?? new URL(fallback, import.meta.url)
  if (String(url).startsWith('file:')) {
    const { readFile } = await import('node:fs/promises')
    return readFile(url)
  }
  return new Uint8Array(await (await fetch(url)).arrayBuffer())
}

/**
 * Load the grammar and the resolver once. `grammar` is tree-sitter-markdown.wasm or a
 * `Language` already loaded; `resolver` is tree-sitter-md.wasm, loaded as a tree-sitter-x
 * extension. Each accepts a URL, a Response (or a promise of one), or bytes.
 * The resolver also accepts a compiled module.
 */
export async function init(options = {}) {
  if (options === null || typeof options !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options))) {
    throw new TypeError('tree-sitter-md: init expects { grammar, resolver }')
  }
  initialization ??= load(options).catch(error => {
    initialization = null
    throw error
  })
  return initialization
}

async function load({ grammar, resolver }) {
  await Parser.init()
  language = grammar instanceof Language ? grammar : await Language.load(await bytes(grammar, '../tree-sitter-markdown.wasm'))
  wasm = await loadExtension(await bytes(resolver, '../tree-sitter-md.wasm'))
}

function write(handle, text) {
  const ptr = wasm.tsmd_input(handle, text.length)
  const view = new Uint16Array(heap().buffer, ptr, text.length)
  for (let i = 0; i < text.length; i++) view[i] = text.charCodeAt(i)
}

function read(handle, count) {
  if (count === 0) return new Uint32Array(0)
  const ptr = wasm.tsmd_out(handle)
  return new Uint32Array(heap().buffer, ptr, count).slice()
}

export class MarkdownDocument {
  #handle
  constructor({ gfm = true, frontmatter = false } = {}) {
    if (!wasm) throw new Error('tree-sitter-md: call init() first')
    this.#handle = wasm.tsmd_new((gfm ? 1 : 0) | (frontmatter ? 2 : 0), language[0])
  }
  /** Replace the whole text and parse it. */
  setText(text) {
    write(this.#handle, text)
    wasm.tsmd_set_text(this.#handle)
  }
  /** Replace `[start, oldEnd)` with `inserted`. */
  edit(start, oldEnd, inserted) {
    write(this.#handle, inserted)
    wasm.tsmd_edit(this.#handle, start, oldEnd)
  }
  /** An unchanged reparse, for idle time after `setText` (keeps it off the first keystroke). */
  reparse() {
    wasm.tsmd_reparse(this.#handle)
  }
  /** Records `[start, end, kind, extra]` for constructs intersecting `[from, to)`. */
  decorations(from, to) {
    return read(this.#handle, wasm.tsmd_decorations(this.#handle, from, to))
  }
  /** Decorations for rows `[fromRow, toRow)`. */
  decorationsForRows(fromRow, toRow) {
    const from = wasm.tsmd_row_start(this.#handle, fromRow)
    const to = wasm.tsmd_row_start(this.#handle, toRow)
    return this.decorations(from, to)
  }
  /** `[start, end]` pairs of foldable multi-line blocks intersecting `[from, to)`. */
  folds(from, to) {
    return read(this.#handle, wasm.tsmd_folds(this.#handle, from, to))
  }
  /** Highlight captures `[start, end, capture]` for `[from, to)`, sorted; names in `CAPTURES`. */
  highlights(from, to) {
    return read(this.#handle, wasm.tsmd_highlights(this.#handle, from, to))
  }
  /** Fenced code injections: `[contentStart, contentEnd, languageStart, languageEnd]`. */
  injections(from, to) {
    return read(this.#handle, wasm.tsmd_injections(this.#handle, from, to))
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
  }
}

/** Bytes of the shared tree-sitter memory, for memory accounting. */
export function memoryBytes() {
  return wasm ? heap().byteLength : 0
}
