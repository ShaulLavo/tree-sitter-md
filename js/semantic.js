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
function children(node, name, validate, length, presentation = false) {
  if (!Array.isArray(node[name])) invalid()
  for (const child of node[name]) validate(child, length, presentation)
}
function link(node) { field(node, 'url', 'string'); nullable(node, 'title', 'string') }
function inline(node, length, presentation = false) {
  range(node, length)
  if (presentation && pending(node, length)) return
  if (VALUES.has(node.type)) { field(node, 'value', 'string'); return }
  if (node.type === 'break') { field(node, 'hard', 'boolean'); return }
  if (node.type === 'footnoteReference') { field(node, 'identifier', 'string'); return }
  if (node.type === 'image') { field(node, 'alt', 'string'); link(node); return }
  if (!INLINE_CONTAINERS.has(node.type)) invalid()
  if (node.type === 'link') link(node)
  children(node, 'children', inline, length, presentation)
}
function item(node, length, presentation = false) {
  range(node, length)
  if (node.type !== 'listItem') invalid()
  field(node, 'spread', 'boolean'); nullable(node, 'checked', 'boolean')
  children(node, 'children', block, length, presentation)
}
function cell(node, length, presentation = false) {
  object(node)
  if (node.range !== null) range(node, length)
  if (node.type !== 'tableCell') invalid()
  children(node, 'children', inline, length, presentation)
  if (node.range === null && node.children.length > 0) invalid()
}
function row(node, length, presentation = false) {
  range(node, length)
  if (node.type !== 'tableRow') invalid()
  children(node, 'cells', cell, length, presentation)
}
function code(node) {
  field(node, 'value', 'string'); nullable(node, 'language', 'string'); nullable(node, 'meta', 'string')
  if (!['open', 'closed', 'indented'].includes(node.fence)) invalid()
}
function list(node, length, presentation = false) {
  field(node, 'ordered', 'boolean'); field(node, 'spread', 'boolean')
  if (node.ordered && (!Number.isSafeInteger(node.start) || node.start < 0)) invalid()
  if (!node.ordered && node.start !== null) invalid()
  children(node, 'items', item, length, presentation)
}
function table(node, length, presentation = false) {
  if (!Array.isArray(node.align) || !node.align.every(value => ALIGNMENTS.has(value))) invalid()
  children(node, 'rows', row, length, presentation)
  if (!node.rows.every(value => value.cells.length === node.align.length)) invalid()
}
function block(node, length, presentation = false) {
  range(node, length)
  if (presentation && node.type === 'pendingMath') { pending(node, length); return }
  switch (node.type) {
    case 'paragraph': children(node, 'children', inline, length, presentation); return
    case 'heading':
      if (!Number.isInteger(node.depth) || node.depth < 1 || node.depth > 6) invalid()
      children(node, 'children', inline, length, presentation); return
    case 'quote': children(node, 'children', block, length, presentation); return
    case 'footnoteDefinition': field(node, 'identifier', 'string'); children(node, 'children', block, length, presentation); return
    case 'list': list(node, length, presentation); return
    case 'code': code(node); return
    case 'html': case 'math': field(node, 'value', 'string'); return
    case 'definition': field(node, 'identifier', 'string'); link(node); return
    case 'thematicBreak': return
    case 'table': table(node, length, presentation); return
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

function pending(node, length) {
  if (!['pendingLink', 'pendingImage', 'pendingMath'].includes(node.type)) return false
  if ('url' in node || 'title' in node) invalid()
  if (node.type === 'pendingLink') children(node, 'children', inline, length, true)
  if (node.type === 'pendingImage') field(node, 'alt', 'string')
  if (node.type === 'pendingMath') field(node, 'value', 'string')
  return true
}

function metadataArray(result, name, validate, root, length) {
  if (!Array.isArray(result[name])) invalid()
  for (const entry of result[name]) validate(entry, root, length)
}
function reason(entry) {
  field(entry, 'reason', 'string')
  if (entry.reason.length === 0) invalid()
}
function provisional(entry, root) {
  object(entry); reason(entry)
  if (!Array.isArray(entry.path) || entry.path.length === 0 || entry.path.length % 2 !== 0) invalid()
  let node = root
  for (let index = 0; index < entry.path.length; index += 2) {
    node = pathChild(node, entry.path[index], entry.path[index + 1])
  }
  object(node)
  if (typeof node.type !== 'string') invalid()
}
function pathChild(node, field, index) {
  object(node)
  if (!['children', 'items', 'rows', 'cells'].includes(field)) invalid()
  if (!Array.isArray(node[field]) || !Number.isSafeInteger(index) || index < 0 || index >= node[field].length) invalid()
  return node[field][index]
}
function suppressed(entry, root, length) {
  range(entry, length); reason(entry)
  if (entry.range.start === entry.range.end) invalid()
}
function reference(entry, root, length) {
  range(entry, length); field(entry, 'identifier', 'string')
  if (!['link', 'footnote'].includes(entry.kind)) invalid()
  if (!['resolved', 'unresolved'].includes(entry.resolution)) invalid()
}
function hasPending(node) {
  if (['pendingLink', 'pendingImage', 'pendingMath'].includes(node.type)) return true
  return ['children', 'items', 'rows', 'cells'].some(name => Array.isArray(node[name]) && node[name].some(hasPending))
}

export function decodePresentation(text, length, input) {
  if (!Number.isSafeInteger(length) || length < 0 || !['open', 'ended'].includes(input)) invalid()
  const result = JSON.parse(text)
  object(result); range(result.root, length)
  if (result.input !== input) invalid()
  const { root } = result
  if (root.type !== 'root' || root.range.start !== 0 || root.range.end !== length) invalid()
  children(root, 'children', block, length, true)
  metadataArray(result, 'provisional', provisional, root, length)
  metadataArray(result, 'suppressed', suppressed, root, length)
  metadataArray(result, 'references', reference, root, length)
  if (input === 'ended' && (result.provisional.length || result.suppressed.length || hasPending(root))) invalid()
  return result
}
