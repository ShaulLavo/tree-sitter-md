import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import type { SemanticRoot, SemanticBlock, SemanticInline, SemanticListItem, SemanticTableRow, SemanticTableCell,
  PresentationRoot, PresentationBlock, PresentationInline, PresentationListItem, PresentationTableRow, PresentationTableCell } from '../js/semantic.js'

await init()

const options = { gfm: true, cjk: true, math: false }
const disclosed = '- > \t$$meta\r\n  > \ty\r\n  > \t$$\r\n\r\n# tail\ud83d'
type RangeNode = SemanticRoot | SemanticBlock | SemanticInline | SemanticListItem | SemanticTableRow | SemanticTableCell
  | PresentationRoot | PresentationBlock | PresentationInline | PresentationListItem | PresentationTableRow | PresentationTableCell

function children(node: RangeNode): readonly RangeNode[] {
  if ('children' in node) return node.children
  if ('items' in node) return node.items
  if ('rows' in node) return node.rows
  if ('cells' in node) return node.cells
  return []
}

function assertOwnership(node: RangeNode, parent?: RangeNode): void {
  if (node.range && parent?.range) {
    assert.ok(node.range.start >= parent.range.start && node.range.end <= parent.range.end,
      `${node.type} ${JSON.stringify(node.range)} escapes ${parent.type} ${JSON.stringify(parent.range)}`)
  }
  for (const child of children(node)) assertOwnership(child, node)
}

function snapshot(document: MarkdownDocument, source: string) {
  const { revision, ...exact } = document.semantics()
  const { revision: openRevision, ...open } = document.presentation({ input: 'open' })
  const { revision: endedRevision, ...ended } = document.presentation({ input: 'ended' })
  assert.equal(open.source, source)
  assert.equal(ended.source, source)
  assertOwnership(exact.root)
  assertOwnership(open.root)
  assert.deepEqual(ended.root, exact.root)
  return { exact, open, ended, decorations: Array.from(document.decorations(0, source.length)),
    folds: Array.from(document.folds(0, source.length)), injections: Array.from(document.injections(0, source.length)) }
}

function fresh(source: string, math = false) {
  const document = new MarkdownDocument({ ...options, math })
  try {
    document.setText(source)
    return snapshot(document, source)
  } finally { document.dispose() }
}

for (const eol of ['\n', '\r\n']) {
  const source = '- > \t$$meta' + eol + '  >'
  test('list item owns its final quote marker: ' + JSON.stringify(eol), () => {
    const root = fresh(source).exact.root
    const list = root.children[0]
    assert.equal(list?.type, 'list')
    if (list.type !== 'list') throw new Error('expected list')
    const item = list.items[0]
    const quote = item.children[0]
    assert.equal(quote?.type, 'quote')
    if (quote.type !== 'quote') throw new Error('expected quote')
    assert.deepEqual(list.range, { start: 0, end: source.length })
    assert.deepEqual(item.range, { start: 0, end: source.length })
    assert.deepEqual(quote.range, { start: 2, end: source.length })
    assert.deepEqual(quote.children, [{ type: 'code', range: { start: 4, end: 11 },
      value: '$$meta', language: null, meta: null, fence: 'indented' }])
  })
}

for (const math of [false, true]) test('every disclosed UTF-16 prefix keeps container ownership and profile isolation: ' + math, () => {
  const document = new MarkdownDocument({ ...options, math })
  const sibling = new MarkdownDocument({ ...options, math: !math })
  let received = ''
  try {
    sibling.setText(disclosed)
    const saved = snapshot(sibling, disclosed)
    for (const unit of disclosed.split('')) {
      document.edit(received.length, received.length, unit)
      received += unit
      assert.deepEqual(snapshot(document, received), fresh(received, math), JSON.stringify(received))
      assert.deepEqual(snapshot(sibling, disclosed), saved)
    }
    for (let length = received.length - 1; length >= 0; length--) {
      document.edit(length, received.length, '')
      received = received.slice(0, length)
      assert.deepEqual(snapshot(document, received), fresh(received, math), JSON.stringify(received))
    }
  } finally { document.dispose(); sibling.dispose() }
})

for (const source of ['- > a\n  >', '- > > \tx\r\n  > >', '- - > \tx\r\n    >']) {
  test('nested containers keep their own final markers: ' + JSON.stringify(source), () => {
    const root = fresh(source).exact.root
    const list = root.children[0]
    assert.equal(list?.type, 'list')
    if (list.type !== 'list') throw new Error('expected list')
    assert.equal(list.range.end, source.length)
    assert.equal(list.items[0].range.end, source.length)
  })
}
