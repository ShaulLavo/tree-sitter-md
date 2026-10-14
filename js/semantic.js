const INLINE_CONTAINERS = new Set(['emphasis', 'strong', 'delete', 'link'])
const VALUES = new Set(['text', 'code', 'html', 'math'])
const ALIGNMENTS = new Set([null, 'left', 'center', 'right'])

function invalid() { throw new TypeError('tree-sitter-md: invalid semantic result') }
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
}
function field(value, name, type) { if (typeof value[name] !== type) invalid() }
function nullable(value, name, type) {
  if (value[name] !== null && typeof value[name] !== type) invalid()
}
function range(node, length) {
  object(node); object(node.range)
  const { start, end } = node.range
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > length) invalid()
}
function children(node, name, validate, length) {
  if (!Array.isArray(node[name])) invalid()
  for (const child of node[name]) validate(child, length)
}
function link(node) { field(node, 'url', 'string'); nullable(node, 'title', 'string') }
function inline(node, length) {
  range(node, length)
  if (VALUES.has(node.type)) { field(node, 'value', 'string'); return }
  if (node.type === 'break') { field(node, 'hard', 'boolean'); return }
  if (node.type === 'footnoteReference') { field(node, 'identifier', 'string'); return }
  if (node.type === 'image') { field(node, 'alt', 'string'); link(node); return }
  if (!INLINE_CONTAINERS.has(node.type)) invalid()
  if (node.type === 'link') link(node)
  children(node, 'children', inline, length)
}
function item(node, length) {
  range(node, length)
  if (node.type !== 'listItem') invalid()
  field(node, 'spread', 'boolean'); nullable(node, 'checked', 'boolean')
  children(node, 'children', block, length)
}
function cell(node, length) {
  object(node)
  if (node.range !== null) range(node, length)
  if (node.type !== 'tableCell') invalid()
  children(node, 'children', inline, length)
  if (node.range === null && node.children.length > 0) invalid()
}
function row(node, length) {
  range(node, length)
  if (node.type !== 'tableRow') invalid()
  children(node, 'cells', cell, length)
}
function code(node) {
  field(node, 'value', 'string'); nullable(node, 'language', 'string'); nullable(node, 'meta', 'string')
  if (!['open', 'closed', 'indented'].includes(node.fence)) invalid()
}
function list(node, length) {
  field(node, 'ordered', 'boolean'); field(node, 'spread', 'boolean')
  if (node.ordered && (!Number.isSafeInteger(node.start) || node.start < 0)) invalid()
  if (!node.ordered && node.start !== null) invalid()
  children(node, 'items', item, length)
}
function table(node, length) {
  if (!Array.isArray(node.align) || !node.align.every(value => ALIGNMENTS.has(value))) invalid()
  children(node, 'rows', row, length)
  if (!node.rows.every(value => value.cells.length === node.align.length)) invalid()
}
function block(node, length) {
  range(node, length)
  switch (node.type) {
    case 'paragraph': children(node, 'children', inline, length); return
    case 'heading':
      if (!Number.isInteger(node.depth) || node.depth < 1 || node.depth > 6) invalid()
      children(node, 'children', inline, length); return
    case 'quote': children(node, 'children', block, length); return
    case 'footnoteDefinition': field(node, 'identifier', 'string'); children(node, 'children', block, length); return
    case 'list': list(node, length); return
    case 'code': code(node); return
    case 'html': case 'math': field(node, 'value', 'string'); return
    case 'definition': field(node, 'identifier', 'string'); link(node); return
    case 'thematicBreak': return
    case 'table': table(node, length); return
    default: invalid()
  }
}

export function decodeSemanticRoot(text, length) {
  const root = JSON.parse(text)
  range(root, length)
  if (root.type !== 'root' || root.range.start !== 0 || root.range.end !== length) invalid()
  children(root, 'children', block, length)
  return root
}
