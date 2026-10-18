import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'

await init()

const options = { gfm: true, cjk: true, math: true }
const range = (start, end) => ({ start, end })
const node = (type, start, end, fields = {}) => ({ type, range: range(start, end), ...fields })
const text = (value, start, end) => node('text', start, end, { value })
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


function assertBlockMath(node, start, end, value, meta) {
  assert.deepEqual(node.range, range(start, end))
  assert.equal(node.type, 'math')
  assert.equal(node.value, value)
  assert.equal(node.meta, meta)
}

test('CHAT flow math separates line-start openings from paragraph text', () => {
  const { semantic, open } = snapshot('A $$x\ny\n$$')
  assert.deepEqual(semantic.root.children, [
    node('paragraph', 0, 7, { children: [text('A $$x', 0, 5), node('break', 5, 6, { hard: false }), text('y', 6, 7)] }),
    node('math', 8, 10, { value: '', meta: null }),
  ])
  assert.deepEqual(open.root.children, [semantic.root.children[0], node('pendingMath', 8, 10, { value: '', meta: null })])
  assert.deepEqual(open.provisional, [{ path: ['children', 1], reason: 'unclosed-math' }])
})

test('CHAT flow math preserves opening metadata and body text across line endings', () => {
  for (const [source, mathRange] of [
    ['$$x\ny\n$$', range(0, 8)],
    ['$$x\r\ny\r\n$$', range(0, 10)],
    ['$$x\ry\r$$', range(0, 8)],
  ]) {
    const { semantic, open } = snapshot(source)
    const math = semantic.root.children[0]
    assertBlockMath(math, mathRange.start, mathRange.end, 'y', 'x')
    assert.deepEqual(open.root.children, semantic.root.children)
    assert.deepEqual(open.provisional, [])
  }
})

test('CHAT flow math keeps nested container ownership and partial-tab prefixes', () => {
  for (const source of ['> $$x\n> y\n> $$', '- > $$x\n  > y\n  > $$', '> \t$$x\n> \ty\n> \t$$']) {
    const { semantic, open } = snapshot(source)
    assert.equal(open.source, source)
    assertOwnership(semantic.root)
    const math = descendants(semantic.root, 'math').find(node => node.meta === 'x')
    assert.ok(math)
    assert.equal(math.value, 'y')
    assert.equal(math.meta, 'x')
  }
})

test('CHAT flow math leaves same-line inline math and literal controls unchanged', () => {
  const inline = snapshot('p $$x\ny$$ q').semantic.root.children[0]
  assert.deepEqual(inline.children.map(node => node.type), ['text', 'math', 'text'])
  assert.deepEqual(inline.children[1], node('math', 2, 9, { value: 'x\ny' }))
  for (const source of ['p $x$ q', 'p $$x q']) {
    const paragraph = snapshot(source).semantic.root.children[0]
    assert.deepEqual(paragraph.children, [text(source, 0, source.length)])
  }
})

test('CHAT flow math exposes empty body metadata for an unclosed opening', () => {
  const { semantic, open } = snapshot('$$x *a*')
  assert.deepEqual(semantic.root.children, [node('math', 0, 7, { value: '', meta: 'x *a*' })])
  assert.deepEqual(open.root.children, [node('pendingMath', 0, 7, { value: '', meta: 'x *a*' })])
  assert.deepEqual(open.provisional, [{ path: ['children', 0], reason: 'unclosed-math' }])
})

test('CHAT math retains exact source with a lone surrogate before a flow block', () => {
  const source = '\ud83d\n$$x\ny\n$$'
  const { semantic, open } = snapshot(source)
  assert.equal(sourceHash(source), '57d58ea1978f1744ccc09560e6af116cb08b07ad5c87960f61c0c87650a123be')
  assert.equal(open.source, source)
  const math = semantic.root.children[1]
  assertBlockMath(math, 2, 10, 'y', 'x')
})


test('CHAT flow metadata decodes string escapes and keeps trailing metadata space', () => {
  const source = '$$ a &amp; b \\* \nbody\n$$'
  assertBlockMath(snapshot(source).semantic.root.children[0], 0, source.length, 'body', 'a & b * ')
})

test('CHAT flow math strips authored opener indentation from body lines', () => {
  const source = '  $$x\n  y\n  $$'
  assertBlockMath(snapshot(source).semantic.root.children[0], 2, source.length, 'y', 'x')
})


test('exact healed row54 preserves its original UTF16 source and splits final flow opener', () => {
  const source = 'A $$```\nx$x$**[x\uddd1(>xamest/a)\n$$'
  assert.equal(sourceHash(source), '531046c098e4b41991f5f6055b81aadb4f6c3827062fdc17ed7b114d65cba59f')
  const {semantic, open} = snapshot(source)
  assert.equal(open.source, source)
  assert.deepEqual(semantic.root.children.map(child => child.type), ['paragraph', 'math'])
  assert.deepEqual(semantic.root.children[0].range, range(0, 28))
  assertBlockMath(semantic.root.children[1], 29, 31, '', null)
  assertOwnership(semantic.root)
})

test('CHAT flow container continuation is not a lazy paragraph continuation', () => {
  for (const [source, mathStart, containerEnd] of [
    ['> $$x\ny\n$$', 2, 5],
    ['- $$x\ny\n$$', 2, 5],
    ['- > $$x\ny\n$$', 4, 7],
  ]) {
    const {semantic} = snapshot(source)
    assert.deepEqual(semantic.root.children.map(child => child.type), [source[0] === '>' ? 'quote' : 'list', 'paragraph', 'math'])
    assert.equal(semantic.root.children[0].range.end, containerEnd)
    const math = descendants(semantic.root.children[0], 'math')[0]
    assertBlockMath(math, mathStart, containerEnd, '', 'x')
    assertOwnership(semantic.root)
  }
})


test('nonzero quote continuations retain their already-owned LF and CRLF endpoints', () => {
  for (const [source, end] of [['> ```js\n>', 8], ['> ```js\r\n>', 9]]) {
    const {semantic, open} = snapshot(source)
    assert.equal(open.source, source)
    const code = descendants(semantic.root, 'code')[0]
    assert.deepEqual(code.range, range(2, end))
    assertOwnership(semantic.root)
  }
})
