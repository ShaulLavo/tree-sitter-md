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

const quote = (start, end, children) => node('quote', start, end, { children })
const item = (start, end, children) => node('listItem', start, end, { spread: false, checked: null, children })
const list = (start, end, items) => node('list', start, end, { ordered: false, start: null, spread: false, items })
const math = (start, end, value = '', meta = null) => node('math', start, end, { value, meta })
const paragraph = (start, end, value) => node('paragraph', start, end, { children: [text(value, start, end)] })

for (const [source, children] of [
  ['> $$x\ny\n$$', [quote(0, 5, [math(2, 5, '', 'x')]), paragraph(6, 7, 'y'), math(8, 10)]],
  ['- $$x\ny\n$$', [list(0, 5, [item(0, 5, [math(2, 5, '', 'x')])]), paragraph(6, 7, 'y'), math(8, 10)]],
  ['- > $$x\ny\n$$', [list(0, 7, [item(0, 7, [quote(2, 7, [math(4, 7, '', 'x')])])]), paragraph(8, 9, 'y'), math(10, 12)]],
  ['- > $$x\n  y\n  $$', [list(0, 16, [item(0, 16, [quote(2, 7, [math(4, 7, '', 'x')]), paragraph(10, 11, 'y'), math(14, 16)])])]],
  ['> - $$x\n> y\n> $$', [quote(0, 16, [list(2, 7, [item(2, 7, [math(4, 7, '', 'x')])]), paragraph(10, 11, 'y'), math(14, 16)])]],
]) {
  test('CHAT flow exits to the matching ancestor: ' + JSON.stringify(source), () => {
    const { semantic, open } = snapshot(source)
    assert.deepEqual(semantic.root.children, children)
    assertOwnership(semantic.root)
    assert.equal(open.source, source)
    assert.equal(open.provisional.length, 1)
    assert.deepEqual(descendants(open.root, 'pendingMath').map(n => n.range), [children.at(-1).type === 'math' ? children.at(-1).range : range(14, 16)])
  })
}

for (const source of ['> $$x\n> y\n> $$  ', '> $$x   ', '- $$x\n\ny', '$$x\ny\n', '$$x\n\n']) {
  test('CHAT math keeps authored whitespace endpoints: ' + JSON.stringify(source), () => {
    const { semantic } = snapshot(source)
    assertOwnership(semantic.root)
    const first = descendants(semantic.root, 'math')[0]
    assertBlockMath(first, source[0] === '>' || source[0] === '-' ? 2 : 0, source === '- $$x\n\ny' ? 6 : source.length, source.includes('y\n') ? 'y' : '', source === '> $$x   ' ? 'x   ' : 'x')
  })
}

test('CHAT raw math does not create definitions, footnotes, headings or inline records', () => {
  const source = '$$x\n[id]: /inside\n[^n]: hidden\n# heading\n- item\n| table |\n**bold**\n$$\n\n[id] [^n]'
  const document = new MarkdownDocument(options)
  try {
    document.setText(source)
    const { root } = document.semantics()
    assert.deepEqual(root.children.map(n => n.type), ['math', 'paragraph'])
    assert.equal(root.children[0].value, '[id]: /inside\n[^n]: hidden\n# heading\n- item\n| table |\n**bold**')
    assert.deepEqual(root.children[1].children.map(n => n.type), ['text'])
    assert.equal(document.injections().length, 0)
    assert.equal(document.decorations(0, source.indexOf('\n\n')).length, 0)
  } finally { document.dispose() }
})

test('CHAT flow interruption and closed-flow tail use normal block ownership', () => {
  const source = '> a\n> $$x\n> # raw\n> $$\n> prose\n\n# root'
  const { semantic, open } = snapshot(source)
  assert.deepEqual(semantic.root.children.map(n => n.type), ['quote', 'heading'])
  assert.deepEqual(semantic.root.children[0].children.map(n => n.type), ['paragraph', 'math', 'paragraph'])
  assert.equal(semantic.root.children[0].children[1].value, '# raw')
  assert.deepEqual(open.provisional, [])
  assertOwnership(semantic.root)
})

for (const width of [2, 3, 255, 256, 257]) {
  test('CHAT flow delimiter width is not truncated: ' + width, () => {
    const fence = '$'.repeat(width)
    const source = fence + 'meta\n' + '$'.repeat(width - 1) + '\n' + fence + ' invalid\n' + fence + '$ \t'
    const { semantic } = snapshot(source)
    assert.deepEqual(semantic.root.children, [math(0, source.length, '$'.repeat(width - 1) + '\n' + fence + ' invalid', 'meta')])
  })
}

function comparable(document, source) {
  const { revision, ...exact } = document.semantics()
  const { revision: openRevision, ...open } = document.presentation({ input: 'open' })
  assert.equal(open.source, source)
  return { exact, open, decorations: Array.from(document.decorations(0, source.length)), folds: Array.from(document.folds()), injections: Array.from(document.injections()) }
}

function assertFresh(document, source, settings) {
  const fresh = new MarkdownDocument(settings)
  try {
    fresh.setText(source)
    assert.deepEqual(comparable(document, source), comparable(fresh, source), JSON.stringify(source))
  } finally { fresh.dispose() }
}

for (const enabled of [false, true]) {
  test('CHAT grammar profiles stay isolated through incremental delimiter and prefix edits: ' + enabled, () => {
    const settings = { ...options, math: enabled }
    const document = new MarkdownDocument(settings)
    const sibling = new MarkdownDocument({ ...options, math: !enabled })
    const source = '- > \t$$meta\r\n  > \ty\r\n  > \t$$\r\n\r\n# tail\ud83d'
    sibling.setText(source)
    const saved = comparable(sibling, source)
    let received = ''
    try {
      document.setText(received)
      for (const unit of source.split('')) {
        document.edit(received.length, received.length, unit)
        received += unit
        assertFresh(document, received, settings)
        assert.deepEqual(comparable(sibling, source), saved)
      }
      for (const [from, to, inserted] of [[2, 4, ''], [0, 2, ''], [0, 0, '> '], [0, 2, ''], [2, 3, ''], [2, 2, '$']]) {
        document.edit(from, to, inserted)
        received = received.slice(0, from) + inserted + received.slice(to)
        assertFresh(document, received, settings)
      }
    } finally { document.dispose(); sibling.dispose() }
  })
}

test('math-disabled lazy paragraphs retain their authored membership', () => {
  for (const source of ['> $$x\ny\n$$', '- $$x\ny\n$$', '> a\nb', '- a\nb']) {
    const document = new MarkdownDocument({ math: false })
    try {
      document.setText(source)
      const root = document.semantics().root
      assert.equal(root.children.length, 1)
      assert.equal(descendants(root, 'math').length, 0)
      assert.equal(descendants(root, 'paragraph').length, 1)
      assertOwnership(root)
    } finally { document.dispose() }
  }
})

for (const [source, value] of [['> $$x\n> ', ''], ['> $$x\n> y\n> ', 'y'], ['- > $$x\n  > ', '']]) {
  test('a received full container prefix still belongs to open math: ' + JSON.stringify(source), () => {
    const { semantic, open } = snapshot(source)
    const first = descendants(semantic.root, 'math')[0]
    assertBlockMath(first, source.startsWith('-') ? 4 : 2, source.lastIndexOf('\n') + 1, value, 'x')
    assert.equal(semantic.root.children[0].range.end, source.length)
    assertOwnership(semantic.root)
    assert.equal(open.provisional.length, 1)
  })
}
