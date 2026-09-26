// Normalized construct lists: "kind@start-end[:extra]", ranges trimmed of whitespace.
// The same list is produced from micromark's mdast, tree-sitter's two trees and lezer's tree.

import { decodeString } from 'micromark-util-decode-string'
import { normalizeIdentifier } from 'micromark-util-normalize-identifier'
const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r'
export function trimRange(text, s, e) {
  while (s < e && isSpace(text[s])) s++
  while (e > s && isSpace(text[e - 1])) e--
  return [s, e]
}
const item = (text, kind, s, e, extra) => {
  const [a, b] = trimRange(text, s, e)
  return extra === undefined ? `${kind}@${a}-${b}` : `${kind}@${a}-${b}:${extra}`
}

// Kinds compared for the spec pass rate. `tight` is reported separately.
export const KINDS = [
  'p', 'h', 'hr', 'code', 'bq', 'list', 'li', 'task', 'hblock', 'def', 'table',
  'em', 'strong', 'del', 'cspan', 'a', 'img', 'htag', 'br', 'math', 'imath',
]

/* ---------------- micromark / mdast ---------------- */
const FLOW_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition'])
export function fromMdast(text, root) {
  const out = []
  const visit = (node, parent) => {
    const p = node.position
    const s = p?.start.offset, e = p?.end.offset
    const add = (kind, extra) => out.push(item(text, kind, s, e, extra))
    switch (node.type) {
      case 'paragraph':
        // A paragraph inside a tight list item still exists in mdast; tree-sitter and lezer keep it too.
        add('p'); break
      case 'heading': add('h', node.depth); break
      case 'thematicBreak': add('hr'); break
      case 'code': add('code', node.lang ?? ''); break
      case 'blockquote': add('bq'); break
      case 'list': {
        add('list', node.ordered ? 'ol' : 'ul')
        const loose = node.spread || node.children.some((c) => c.spread)
        out.push(item(text, 'tight', s, e, loose ? 'loose' : 'tight'))
        break
      }
      case 'listItem':
        add('li')
        if (node.checked === true || node.checked === false) out.push(item(text, 'task', s, s + 1, node.checked ? 'x' : ' '))
        break
      case 'html': add(FLOW_PARENTS.has(parent?.type) ? 'hblock' : 'htag'); break
      case 'definition': add('def'); break
      case 'table': add('table', (node.align ?? []).map((a) => a ?? '-').join(',')); break
      case 'emphasis': add('em'); break
      case 'strong': add('strong'); break
      case 'delete': add('del'); break
      case 'inlineCode': add('cspan'); break
      case 'link': case 'linkReference': add('a'); break
      case 'image': case 'imageReference': add('img'); break
      case 'break': add('br'); break
      case 'math': add('math'); break
      case 'inlineMath': add('imath'); break
    }
    if (node.children) for (const child of node.children) visit(child, node)
  }
  visit(root, null)
  return fixTaskPositions(out)
}
// Task markers are compared by the list item they belong to, not their own offset.
function fixTaskPositions(list) {
  return list.map((entry) => (entry.startsWith('task@') ? entry.replace(/@\d+-\d+/, '') : entry))
}

/* ---------------- tree-sitter ---------------- */
const TS_BLOCK = {
  paragraph: 'p', thematic_break: 'hr', block_quote: 'bq', list_item: 'li', html_block: 'hblock',
  link_reference_definition: 'def', fenced_code_block: 'code', indented_code_block: 'code',
}
const TS_INLINE = {
  emphasis: 'em', strong_emphasis: 'strong', strikethrough: 'del', code_span: 'cspan',
  inline_link: 'a', full_reference_link: 'a', collapsed_reference_link: 'a', shortcut_link: 'a',
  uri_autolink: 'a', email_autolink: 'a', image: 'img', html_tag: 'htag', hard_line_break: 'br',
  latex_block: 'imath',
}
// Tree-sitter block nodes end after the next line's `> ` continuation; drop that tail.
const tsItem = (text, kind, s, e, extra) => {
  const tail = /\n[ \t>]*$/.exec(text.slice(s, e))
  return item(text, kind, s, tail ? e - tail[0].length : e, extra)
}
export function fromTreeSitter(text, block, inlines, { refcheck = false } = {}) {
  const out = []
  const defs = new Set()
  const refs = []
  const walk = (node, fn) => {
    fn(node)
    for (const child of node.namedChildren) walk(child, fn)
  }
  walk(block.rootNode, (node) => {
    const t = node.type
    const s = node.startIndex, e = node.endIndex
    const item = tsItem
    if (t === 'paragraph' && node.parent?.type === 'setext_heading') return
    if (t === 'link_reference_definition') {
      const label = node.namedChildren.find((c) => c.type === 'link_label')
      if (label) defs.add(normalizeIdentifier(text.slice(label.startIndex + 1, label.endIndex - 1)))
    }
    if (t === 'atx_heading') {
      const marker = node.namedChildren.find((c) => c.type.startsWith('atx_h'))
      out.push(item(text, 'h', s, e, Number(marker.type[5])))
      return
    }
    if (t === 'setext_heading') {
      const u = node.namedChildren.find((c) => c.type.startsWith('setext_h'))
      out.push(item(text, 'h', s, e, u.type === 'setext_h1_underline' ? 1 : 2))
      return
    }
    if (t === 'list') {
      const marker = node.namedChildren[0]?.namedChildren[0]?.type ?? ''
      out.push(item(text, 'list', s, e, /dot|paren/.test(marker) ? 'ol' : 'ul'))
      return
    }
    if (t === 'list_item') {
      out.push(item(text, 'li', s, e))
      const task = node.namedChildren.find((c) => c.type.startsWith('task_list_marker'))
      if (task) out.push(`task:${task.type.endsWith('checked') && !task.type.endsWith('unchecked') ? 'x' : ' '}`)
      return
    }
    if (t === 'fenced_code_block') {
      const info = node.namedChildren.find((c) => c.type === 'info_string')
      const lang = info?.namedChildren.find((c) => c.type === 'language')
      out.push(item(text, 'code', s, e, lang ? decodeString(text.slice(lang.startIndex, lang.endIndex)) : ''))
      return
    }
    if (t === 'pipe_table') {
      const row = node.namedChildren.find((c) => c.type === 'pipe_table_delimiter_row')
      const aligns = (row?.namedChildren ?? []).filter((c) => c.type === 'pipe_table_delimiter_cell').map((cell) => {
        const left = cell.namedChildren.some((c) => c.type === 'pipe_table_align_left')
        const right = cell.namedChildren.some((c) => c.type === 'pipe_table_align_right')
        if (left && right) return 'center'
        if (left) return 'left'
        if (right) return 'right'
        return '-'
      })
      out.push(item(text, 'table', s, e, aligns.join(',')))
      return
    }
    const kind = TS_BLOCK[t]
    if (kind === 'code') out.push(item(text, 'code', s, e, ''))
    else if (kind) out.push(item(text, kind, s, e))
  })
  for (const tree of inlines) {
    walk(tree.rootNode, (node) => {
      const kind = TS_INLINE[node.type]
      if (!kind) return
      // `~~a~~` arrives as a strikethrough wrapping a strikethrough one character in; count it once.
      if (kind === 'del' && node.parent?.type === 'strikethrough' && node.parent.startIndex === node.startIndex - 1 && node.parent.endIndex === node.endIndex + 1) return
      const entry = item(text, kind, node.startIndex, node.endIndex)
      out.push(entry)
      const label = tsRefLabel(text, node)
      if (label !== null) refs.push([entry, label])
    })
  }
  return finish(out, refcheck ? refs.filter(([, l]) => !defs.has(l)).map(([e]) => e) : [])
}
function tsRefLabel(text, node) {
  const t = node.type
  if (t === 'image') {
    // `![a](b)` has a destination; `![a]`, `![a][]`, `![a][b]` do not.
    if (node.namedChildren.some((c) => c.type === 'link_destination') || text.slice(node.startIndex, node.endIndex).endsWith(')')) return null
    const label = node.namedChildren.find((c) => c.type === 'link_label')
    const desc = node.namedChildren.find((c) => c.type === 'image_description')
    const src = label ?? desc
    if (!src) return null
    return normalizeIdentifier(text.slice(src.startIndex, src.endIndex).replace(/^\[|\]$/g, ''))
  }
  if (t !== 'shortcut_link' && t !== 'collapsed_reference_link' && t !== 'full_reference_link') return null
  const label = node.namedChildren.find((c) => c.type === 'link_label')
  const src = label ?? node.namedChildren.find((c) => c.type === 'link_text')
  if (!src) return null
  return normalizeIdentifier(text.slice(src.startIndex, src.endIndex).replace(/^\[|\]$/g, ''))
}
// Drop unresolved references and anything inside an image description (alt text is plain).
export function finish(out, dropped) {
  const drop = new Set(dropped)
  const images = out.filter((e) => e.startsWith('img@')).map((e) => e.slice(4).split(/[-:]/).map(Number))
  return out.filter((e) => {
    if (drop.has(e)) { drop.delete(e); return false }
    const m = /@(\d+)-(\d+)/.exec(e)
    if (!m) return true
    const a = Number(m[1]), b = Number(m[2])
    return !images.some(([s, t]) => s <= a && b <= t && !(s === a && b === t))
  })
}

/* ---------------- lezer ---------------- */
const LZ = {
  Paragraph: 'p', HorizontalRule: 'hr', Blockquote: 'bq', ListItem: 'li', HTMLBlock: 'hblock',
  CommentBlock: 'hblock', ProcessingInstructionBlock: 'hblock', LinkReference: 'def', CodeBlock: 'code',
  Emphasis: 'em', StrongEmphasis: 'strong', Strikethrough: 'del', InlineCode: 'cspan', Link: 'a',
  Autolink: 'a', Image: 'img', HTMLTag: 'htag', Comment: 'htag', ProcessingInstruction: 'htag', HardBreak: 'br',
  InlineMath: 'imath', BlockMath: 'math',
}
export function fromLezer(text, tree, { refcheck = false } = {}) {
  const out = []
  const defs = new Set()
  const refs = []
  const cursor = tree.cursor()
  const parentNames = []
  do {
    const name = cursor.name
    const s = cursor.from, e = cursor.to
    const m = /^(ATX|Setext)Heading(\d)$/.exec(name)
    if (m) out.push(item(text, 'h', s, e, Number(m[2])))
    else if (name === 'BulletList' || name === 'OrderedList') out.push(item(text, 'list', s, e, name === 'OrderedList' ? 'ol' : 'ul'))
    else if (name === 'FencedCode') {
      const node = cursor.node
      const info = node.getChild('CodeInfo')
      out.push(item(text, 'code', s, e, info ? decodeString(text.slice(info.from, info.to).split(/\s/)[0]) : ''))
    } else if (name === 'Table') {
      const node = cursor.node
      const delim = node.getChild('TableDelimiter')
      const aligns = delim ? text.slice(delim.from, delim.to).replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => {
        const c = cell.trim()
        const l = c.startsWith(':'), r = c.endsWith(':')
        if (l && r) return 'center'
        if (l) return 'left'
        if (r) return 'right'
        return '-'
      }) : []
      out.push(item(text, 'table', s, e, aligns.join(',')))
    } else if (name === 'Task') {
      const node = cursor.node
      const marker = node.getChild('TaskMarker')
      out.push(`task:${marker && /x/i.test(text.slice(marker.from, marker.to)) ? 'x' : ' '}`)
      out.push(item(text, 'p', marker ? marker.to : s, e))
    } else if (name === 'URL' && cursor.node.parent?.name === 'Paragraph') {
      out.push(item(text, 'a', s, e)) // GFM autolink literal
    } else if (name === 'URL' && !['Link', 'Image', 'Autolink', 'LinkReference'].includes(cursor.node.parent?.name)) {
      out.push(item(text, 'a', s, e))
    } else if (name === 'CodeBlock') out.push(item(text, 'code', s, e, ''))
    else if (LZ[name]) {
      const entry = item(text, LZ[name], s, e)
      out.push(entry)
      if (name === 'LinkReference') {
        const label = cursor.node.getChild('LinkLabel')
        if (label) defs.add(normalizeIdentifier(text.slice(label.from + 1, label.to - 1)))
      }
      if (name === 'Link' || name === 'Image') {
        const label = lezerRefLabel(text, cursor.node)
        if (label !== null) refs.push([entry, label])
      }
    }
  } while (cursor.next())
  return finish(out, refcheck ? refs.filter(([, l]) => !defs.has(l)).map(([e]) => e) : [])
}
function lezerRefLabel(text, node) {
  if (node.getChild('URL') || text.slice(node.from, node.to).endsWith(')')) return null
  const label = node.getChild('LinkLabel')
  if (label && label.to - label.from > 2) return normalizeIdentifier(text.slice(label.from + 1, label.to - 1))
  const marks = node.getChildren('LinkMark')
  const open = marks[0], close = marks.find((m) => text[m.from] === ']')
  if (!open || !close) return null
  return normalizeIdentifier(text.slice(open.to, close.from))
}

/* ---------------- comparison ---------------- */
export function compare(expected, actual, { ignore = new Set(['tight']) } = {}) {
  const keep = (x) => !ignore.has(x.split(/[@:]/)[0])
  const e = expected.filter(keep).sort()
  const a = actual.filter(keep).sort()
  const missing = diff(e, a)
  const extra = diff(a, e)
  return { pass: missing.length === 0 && extra.length === 0, missing, extra }
}
function diff(a, b) {
  const counts = new Map()
  for (const x of b) counts.set(x, (counts.get(x) ?? 0) + 1)
  const out = []
  for (const x of a) {
    const n = counts.get(x) ?? 0
    if (n > 0) counts.set(x, n - 1)
    else out.push(x)
  }
  return out
}

/* ---------------- tree-sitter-md records ---------------- */
const TSMD = { 1: 'p', 3: 'hr', 5: 'bq', 7: 'li', 9: 'hblock', 10: 'def', 12: 'em', 13: 'strong', 14: 'del', 15: 'cspan', 16: 'a', 17: 'img', 18: 'htag', 19: 'br' }
const ALIGN = ['-', 'left', 'center', 'right']
export function fromTsmd(text, r) {
  const out = []
  for (let i = 0; i < r.length; i += 4) {
    const s = r[i], e = r[i + 1], k = r[i + 2], x = r[i + 3]
    if (k === 2) out.push(tsItem(text, 'h', s, e, x))
    else if (k === 4) {
      let lang = ''
      if (x === 1) for (let j = i + 4; j < r.length && r[j] < e; j += 4) {
        if (r[j + 2] !== 36) continue
        lang = decodeString(text.slice(r[j], r[j + 1]).trim().split(/[ \t]/)[0])
        break
      }
      out.push(tsItem(text, 'code', s, e, lang))
    } else if (k === 6) out.push(tsItem(text, 'list', s, e, x ? 'ol' : 'ul'))
    else if (k === 8) out.push(`task:${x ? 'x' : ' '}`)
    else if (k === 11) {
      const n = x & 255
      const aligns = []
      for (let c = 0; c < n; c++) aligns.push(c < 12 ? ALIGN[(x >>> (8 + 2 * c)) & 3] : '-')
      out.push(tsItem(text, 'table', s, e, aligns.join(',')))
    } else if (TSMD[k]) out.push(k >= 12 ? item(text, TSMD[k], s, e) : tsItem(text, TSMD[k], s, e))
  }
  return finish(out, [])
}
