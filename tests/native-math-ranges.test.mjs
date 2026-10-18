import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'

await init()

const options = { gfm: true, cjk: true, math: true }
const range = (start, end) => ({ start, end })
const sourceHash = source => createHash('sha256').update(Buffer.from(source, 'utf16le')).digest('hex')

function snapshot(source) {
  const document = new MarkdownDocument(options)
  try {
    document.setText(source)
    return { semantic: document.semantics(), open: document.presentation({ input: 'open' }) }
  } finally {
    document.dispose()
  }
}

function descendants(node, type, out = []) {
  if (node.type === type) out.push(node)
  const children = node.children ?? node.items ?? node.rows ?? node.cells ?? []
  for (const child of children) descendants(child, type, out)
  return out
}

function assertOwnership(node, parent = null) {
  if (parent && (node.range.start < parent.range.start || node.range.end > parent.range.end)) {
    assert.fail(`${node.type} ${JSON.stringify(node.range)} escapes ${parent.type} ${JSON.stringify(parent.range)}`)
  }
  const children = node.children ?? node.items ?? node.rows ?? node.cells ?? []
  for (const child of children) assertOwnership(child, node)
}

const rowSource = 'A*x$בגhttps:[x]: /target\n//r_get\n- > ````\n\n$🧑- ‍\ud83d`'

for (const row of [59, 60]) {
  test(`fresh row ${row} preserves source and keeps code inside containers`, () => {
    const { semantic, open } = snapshot(rowSource)
    assert.equal(rowSource.length, 51)
    assert.equal(sourceHash(rowSource), '1f64de85839d2cecfe28559c8e9620200daf7ef67f2aae6ca9ccfaaa013d563f')
    assert.equal(open.source, rowSource)
    assert.deepEqual(semantic.root.range, range(0, 51))
    assertOwnership(semantic.root)

    const list = descendants(semantic.root, 'list')[0]
    const item = descendants(semantic.root, 'listItem')[0]
    const quote = descendants(semantic.root, 'quote')[0]
    const code = descendants(semantic.root, 'code')[0]
    assert.deepEqual(list.range, range(33, 41))
    assert.deepEqual(item.range, range(33, 41))
    assert.deepEqual(quote.range, range(35, 41))
    assert.deepEqual(code.range, range(37, 41))
  })
}

test('nested open fences trim only the owned container boundary for LF and CRLF', () => {
  for (const [source, rootEnd, paragraphStart] of [
    ['- > ````\n\nx', 11, 10],
    ['- > ````\r\n\r\nx', 13, 12],
  ]) {
    const { semantic, open } = snapshot(source)
    const list = descendants(semantic.root, 'list')[0]
    const item = descendants(semantic.root, 'listItem')[0]
    const quote = descendants(semantic.root, 'quote')[0]
    const code = descendants(semantic.root, 'code')[0]
    assert.equal(open.source, source)
    assert.deepEqual(semantic.root.range, range(0, rootEnd))
    assert.deepEqual(list.range, range(0, 8))
    assert.deepEqual(item.range, range(0, 8))
    assert.deepEqual(quote.range, range(2, 8))
    assert.deepEqual(code.range, range(4, 8))
    assert.deepEqual(semantic.root.children.at(-1).range, range(paragraphStart, source.length))
    assertOwnership(semantic.root)
  }
})

test('plain and quote-only open fences keep their existing authored ranges', () => {
  for (const [source, codeRange, parentType, parentRange] of [
    ['> ````\n\nx', range(2, 6), 'quote', range(0, 6)],
    ['````\n\nx', range(0, 7), 'code', range(0, 7)],
  ]) {
    const { semantic, open } = snapshot(source)
    assert.equal(open.source, source)
    const parent = semantic.root.children[0]
    const code = descendants(parent, 'code')[0] ?? parent
    assert.deepEqual(code.range, codeRange)
    if (parentType === 'quote') assert.deepEqual(parent.range, parentRange)
    assertOwnership(semantic.root)
  }
})

test('list-only open fences do not escape their list item owner', () => {
  const source = '- ````\n\nx'
  const { semantic, open } = snapshot(source)
  const item = descendants(semantic.root, 'listItem')[0]
  const code = descendants(semantic.root, 'code')[0]
  assert.equal(open.source, source)
  assert.deepEqual(item.range, range(0, 6))
  assert.deepEqual(code.range, range(2, 6))
  assertOwnership(semantic.root)
})

test('inline multiline math and same-line controls remain unchanged', () => {
  const inline = snapshot('p $$x\ny$$ q').semantic.root.children[0]
  assert.deepEqual(inline.children.map(node => node.type), ['text', 'math', 'text'])
  assert.deepEqual(inline.children[1].range, range(2, 9))
  assert.equal(inline.children[1].value, 'x\ny')
  assert.deepEqual(snapshot('p $x$ q').semantic.root.children[0].children.map(node => node.type), ['text'])
  assert.deepEqual(snapshot('p $$x q').semantic.root.children[0].children.map(node => node.type), ['text'])
})
