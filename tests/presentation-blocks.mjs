import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'

await init()

const options = { gfm: true, cjk: true, math: true }
const range = (start, end) => ({ start, end })
const node = (type, start, end, fields = {}) => ({ type, range: range(start, end), ...fields })
const text = (value, start, end) => node('text', start, end, { value })
const paragraph = (start, end, children) => node('paragraph', start, end, { children })

function descendants(current, type) {
  const children = current.children ?? current.items ?? current.rows ?? current.cells ?? []
  return (current.type === type ? [current] : []).concat(children.flatMap(child => descendants(child, type)))
}

function observation(result) {
  return { root: result.root, provisional: result.provisional, suppressed: result.suppressed, references: result.references }
}

function read(document, source, input = 'open') {
  const result = document.presentation({ input })
  assert.equal(result.source, source)
  assert.equal(result.input, input)
  assert.deepEqual(result.root.range, range(0, source.length))
  assert.equal(result.revision, document.semantics().revision)
  return result
}

function verifyReads(document, source) {
  const exact = document.semantics()
  const open = read(document, source)
  const ended = read(document, source, 'ended')
  assert.deepEqual(ended.root, exact.root)
  assert.deepEqual(ended.provisional, [])
  assert.deepEqual(ended.suppressed, [])
  assert.deepEqual(read(document, source), open)
  assert.deepEqual(document.semantics(), exact)
  return open
}

function compareFresh(document, source) {
  const fresh = new MarkdownDocument(options)
  try {
    fresh.setText(source)
    for (const input of ['open', 'ended']) {
      assert.deepEqual(observation(read(document, source, input)), observation(read(fresh, source, input)))
    }
  } finally {
    fresh.dispose()
  }
}

for (const source of ['#', '######', '>', '-', '+', '*', '1.', '17)', '- [ ]', '- [x]', '- [X]', '> - [ ]']) {
  test('empty trailing block markers retain source while open: ' + JSON.stringify(source), () => {
    const document = new MarkdownDocument(options)
    try {
      document.setText(source)
      const open = verifyReads(document, source)
      assert.deepEqual(open.root.children, [])
      assert.deepEqual(open.provisional, [])
      assert.deepEqual(open.suppressed, [{ range: range(0, source.length), reason: 'empty-trailing-marker' }])
      assert.notDeepEqual(document.presentation({ input: 'ended' }).root.children, [])
    } finally {
      document.dispose()
    }
  })
}

test('suppressing the last empty item preserves received list content and its source ranges', () => {
  const document = new MarkdownDocument(options)
  try {
    document.setText('- a\n-')
    const open = verifyReads(document, '- a\n-')
    assert.deepEqual(open.suppressed, [{ range: range(4, 5), reason: 'empty-trailing-marker' }])
    const items = open.root.children[0].items
    assert.equal(items.length, 1)
    assert.deepEqual(items[0], node('listItem', 0, 3, {
      spread: false, checked: null, children: [paragraph(2, 3, [text('a', 2, 3)])],
    }))
    document.edit(5, 5, ' b')
    const completed = verifyReads(document, '- a\n- b')
    assert.deepEqual(completed.suppressed, [])
    assert.deepEqual(descendants(completed.root, 'text').map(child => child.value), ['a', 'b'])
    compareFresh(document, '- a\n- b')
    document.edit(5, 7, '')
    assert.deepEqual(observation(verifyReads(document, '- a\n-')), observation(open))
  } finally {
    document.dispose()
  }
})

test('empty headings are suppressed only at the current document tail', () => {
  const document = new MarkdownDocument(options)
  try {
    document.setText('Keep\n\n#')
    const open = verifyReads(document, 'Keep\n\n#')
    assert.deepEqual(open.root.children, [paragraph(0, 4, [text('Keep', 0, 4)])])
    assert.deepEqual(open.suppressed, [{ range: range(6, 7), reason: 'empty-trailing-marker' }])
    document.edit(7, 7, '\n\nNext')
    const closed = verifyReads(document, 'Keep\n\n#\n\nNext')
    assert.deepEqual(closed.root.children.map(child => child.type), ['paragraph', 'heading', 'paragraph'])
    assert.deepEqual(closed.root.children[1], node('heading', 6, 7, { depth: 1, children: [] }))
    assert.deepEqual(closed.suppressed, [])
  } finally {
    document.dispose()
  }
})

test('table and setext edits replace earlier block classifications and undo cleanly', () => {
  const document = new MarkdownDocument(options)
  let source = '| a | b |\n| --'
  try {
    document.setText(source)
    const candidate = verifyReads(document, source)
    assert.deepEqual(candidate.root.children, [paragraph(0, 14, [
      text('| a | b |', 0, 9), node('break', 9, 10, { hard: false }), text('| --', 10, 14),
    ])])
    document.edit(14, 14, '- | --- |\n| c | d |')
    source += '- | --- |\n| c | d |'
    const table = verifyReads(document, source).root.children[0]
    assert.equal(table.type, 'table')
    assert.deepEqual(table.align, [null, null])
    assert.deepEqual(table.rows.map(row => row.cells.map(cell => cell.children[0].value)), [['a', 'b'], ['c', 'd']])
    assert.deepEqual(table.rows.map(row => row.cells.map(cell => cell.range)), [[range(0, 4), range(4, 9)], [range(24, 28), range(28, 33)]])
    assert.deepEqual(table.rows.map(row => row.cells.map(cell => cell.children[0].range)), [[range(2, 3), range(6, 7)], [range(26, 27), range(30, 31)]])
    compareFresh(document, source)
    document.edit(14, source.length, '')
    assert.deepEqual(observation(verifyReads(document, '| a | b |\n| --')), observation(candidate))
    document.setText('Title')
    assert.deepEqual(verifyReads(document, 'Title').root.children, [paragraph(0, 5, [text('Title', 0, 5)])])
    document.edit(5, 5, '\n===')
    assert.deepEqual(verifyReads(document, 'Title\n===').root.children, [node('heading', 0, 9, { depth: 1, children: [text('Title', 0, 5)] })])
    document.edit(6, 9, '---')
    assert.equal(verifyReads(document, 'Title\n---').root.children[0].depth, 2)
    document.edit(5, 9, '')
    assert.deepEqual(verifyReads(document, 'Title').root.children, [paragraph(0, 5, [text('Title', 0, 5)])])
    compareFresh(document, 'Title')
  } finally {
    document.dispose()
  }
})

function checkWideRowOwnership(source, row) {
  let owner = row.range.start
  for (const [index, cell] of row.cells.entries()) {
    const inline = cell.children[0]
    assert.equal(source.slice(inline.range.start, inline.range.end), inline.value)
    assert.equal(cell.range.start, owner)
    const nextPipe = source.indexOf('|', owner + 1)
    assert.equal(cell.range.end, index + 1 === row.cells.length ? row.range.end : nextPipe)
    assert.ok(cell.range.start <= inline.range.start && inline.range.end <= cell.range.end)
    owner = cell.range.end
  }
  assert.equal(owner, row.range.end)
}

test('wide GFM tables retain every authored column, value and source span', () => {
  const document = new MarkdownDocument(options)
  const headers = Array.from({ length: 300 }, (_, index) => 'h' + index)
  const values = Array.from({ length: 300 }, (_, index) => 'v' + index)
  const source = '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n| ' + values.join(' | ') + ' |'
  try {
    document.setText(source)
    const table = verifyReads(document, source).root.children[0]
    assert.equal(table.type, 'table')
    assert.equal(table.align.length, 300)
    assert.deepEqual(table.rows.map(row => row.cells.length), [300, 300])
    assert.deepEqual(table.rows.map(row => row.cells.map(cell => cell.children[0].value)), [headers, values])
    for (const row of table.rows) checkWideRowOwnership(source, row)
  } finally {
    document.dispose()
  }
})

for (const [marker, count] of [['`', 17], ['~', 13]]) {
  test('fences preserve shorter runs, partial info, nesting and received whitespace: ' + marker, () => {
    const document = new MarkdownDocument(options)
    const fence = marker.repeat(count)
    const payload = '\t a  \n' + marker.repeat(count - 1) + '\n b'
    const source = '> - ' + fence + 'lang one two\r\n>   \t a  \r\n>   ' + marker.repeat(count - 1) + '\n>    b'
    try {
      document.setText('> - ' + fence + 'la')
      const fragment = descendants(verifyReads(document, '> - ' + fence + 'la').root, 'code')[0]
      assert.equal(fragment.language, 'la')
      assert.equal(fragment.meta, null)
      assert.equal(fragment.value, '')
      document.setText(source)
      const open = verifyReads(document, source)
      assert.equal(open.root.children[0].type, 'quote')
      assert.equal(open.root.children[0].children[0].type, 'list')
      assert.deepEqual(descendants(open.root, 'code'), [node('code', 4, source.length, {
        value: payload, language: 'lang', meta: 'one two', fence: 'open',
      })])
      const closing = '\n>   ' + marker.repeat(count + 1)
      document.edit(source.length, source.length, closing)
      const closed = verifyReads(document, source + closing)
      assert.equal(descendants(closed.root, 'code')[0].value, payload)
      assert.equal(descendants(closed.root, 'code')[0].fence, 'closed')
      compareFresh(document, source + closing)
    } finally {
      document.dispose()
    }
  })
}

test('list tightness follows blank-line insertion and removal', () => {
  const document = new MarkdownDocument(options)
  try {
    document.setText('- one\n- two')
    assert.equal(verifyReads(document, '- one\n- two').root.children[0].spread, false)
    document.edit(6, 6, '\n')
    const loose = verifyReads(document, '- one\n\n- two').root.children[0]
    assert.equal(loose.spread, true)
    assert.deepEqual(descendants(loose, 'text').map(child => child.value), ['one', 'two'])
    compareFresh(document, '- one\n\n- two')
    document.edit(6, 7, '')
    assert.equal(verifyReads(document, '- one\n- two').root.children[0].spread, false)
  } finally {
    document.dispose()
  }
})

for (const [source, type] of [['<span data-x="unfinished', 'paragraph'], ['<!-- unfinished', 'html']]) {
  test('incomplete HTML retains only received literal data: ' + source, () => {
    const document = new MarkdownDocument(options)
    try {
      document.setText(source)
      const result = verifyReads(document, source)
      const block = result.root.children[0]
      assert.equal(block.type, type)
      assert.equal(type === 'paragraph' ? block.children[0].value : block.value, source)
      assert.deepEqual(result.provisional, [])
      assert.deepEqual(result.suppressed, [])
    } finally {
      document.dispose()
    }
  })
}

for (const [source, value, meta, closed] of [
  ['$$x *a*', '', 'x *a*', false],
  ['$$x *a*\nnext', 'next', 'x *a*', false],
  ['$$x *a*\nnext\n$$', 'next', 'x *a*', true],
]) {
  test('same-line block math retains its opening-line suffix in every mode: ' + JSON.stringify(source), () => {
    const document = new MarkdownDocument(options)
    try {
      document.setText(source)
      const open = verifyReads(document, source)
      assert.deepEqual(document.semantics().root.children, [node('math', 0, source.length, { value, meta })])
      assert.deepEqual(open.root.children, [node(closed ? 'math' : 'pendingMath', 0, source.length, { value, meta })])
      assert.deepEqual(open.provisional, closed ? [] : [{ path: ['children', 0], reason: 'unclosed-math' }])
      assert.deepEqual(open.suppressed, [])
    } finally {
      document.dispose()
    }
  })
}

test('disabled GFM preserves task-shaped ordinary content', () => {
  const document = new MarkdownDocument({ gfm: false })
  try {
    for (const source of ['- [ ]', '- [x]']) {
      document.setText(source)
      const result = verifyReads(document, source)
      assert.deepEqual(result.suppressed, [])
      assert.deepEqual(result.root, document.semantics().root)
      assert.equal(descendants(result.root, 'text').map(child => child.value).join(''), source.slice(2))
      assert.equal(result.root.children[0].items[0].checked, null)
    }
  } finally {
    document.dispose()
  }
})

test('disabled math retains ordinary inline interpretation of same-line dollars', () => {
  const document = new MarkdownDocument({ math: false })
  const source = '$$x *a*'
  try {
    document.setText(source)
    const result = verifyReads(document, source)
    assert.deepEqual(result.root.children, [paragraph(0, 7, [
      text('$$x ', 0, 4), node('emphasis', 4, 7, { children: [text('a', 5, 6)] }),
    ])])
    assert.deepEqual(result.provisional, [])
    assert.deepEqual(result.suppressed, [])
  } finally {
    document.dispose()
  }
})

test('nested empty-task suppression keeps earlier quote content and survives undo', () => {
  const document = new MarkdownDocument(options)
  const source = '> keep\n>\n> - [ ]'
  try {
    document.setText(source)
    const before = verifyReads(document, source)
    assert.deepEqual(before.root.children, [node('quote', 0, 16, {
      children: [paragraph(2, 6, [text('keep', 2, 6)])],
    })])
    assert.deepEqual(before.suppressed, [{ range: range(11, 16), reason: 'empty-trailing-marker' }])
    document.edit(16, 16, ' work')
    const after = verifyReads(document, source + ' work')
    assert.deepEqual(after.suppressed, [])
    assert.deepEqual(descendants(after.root, 'text').map(child => child.value), ['keep', 'work'])
    assert.equal(descendants(after.root, 'listItem')[0].checked, false)
    compareFresh(document, source + ' work')
    document.edit(16, 21, '')
    assert.deepEqual(observation(verifyReads(document, source)), observation(before))
  } finally {
    document.dispose()
  }
})

for (const marker of ['#', '>', '*']) {
  test('empty trailing footnote blocks use consumed source extent: ' + marker, () => {
    const document = new MarkdownDocument(options)
    try {
      for (const ending of ['\n', '\n    \n']) {
        const source = '[^n]: ' + marker + ending
        document.setText(source)
        const result = verifyReads(document, source)
        assert.deepEqual(result.root.children, [node('footnoteDefinition', 0, 7, { identifier: 'n', children: [] })])
        assert.deepEqual(result.suppressed, [{ range: range(6, 7), reason: 'empty-trailing-marker' }])
        compareFresh(document, source)
      }
      const source = '[^n]: ' + marker + '\n\nAfter'
      document.setText(source)
      const result = verifyReads(document, source)
      assert.deepEqual(result.suppressed, [])
      assert.equal(result.root.children[0].children.length, 1)
      assert.equal(result.root.children.at(-1).children[0].value, 'After')
    } finally {
      document.dispose()
    }
  })
}

test('a blank line separates literal task text from later item content', () => {
  const document = new MarkdownDocument(options)
  try {
    document.setText('- [ ]\n  content')
    const continuous = verifyReads(document, '- [ ]\n  content').root.children[0].items[0]
    assert.equal(continuous.checked, false)
    assert.deepEqual(descendants(continuous, 'text').map(child => child.value), ['content'])
    document.setText('- [ ]\n\n  content')
    const separate = verifyReads(document, '- [ ]\n\n  content').root.children[0].items[0]
    assert.equal(separate.checked, null)
    assert.equal(separate.spread, true)
    assert.deepEqual(separate.children, [paragraph(2, 5, [text('[ ]', 2, 5)]), paragraph(9, 16, [text('content', 9, 16)])])
    compareFresh(document, '- [ ]\n\n  content')
  } finally {
    document.dispose()
  }
})

test('disabled GFM preserves populated task-shaped text in its paragraph', () => {
  const document = new MarkdownDocument({ gfm: false })
  try {
    for (const marker of ['[ ]', '[x]']) {
      const source = '- ' + marker + ' content'
      document.setText(source)
      const result = verifyReads(document, source)
      const item = result.root.children[0].items[0]
      assert.equal(item.checked, null)
      assert.deepEqual(item.children[0].range, range(2, source.length))
      assert.equal(item.children[0].children.map(child => child.value).join(''), marker + ' content')
    }
  } finally {
    document.dispose()
  }
})
