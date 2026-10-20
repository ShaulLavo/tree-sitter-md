import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import { semanticHtml } from './semantic-html.mjs'

await init()

function snapshot(source, options) {
  const document = new MarkdownDocument(options)
  try {
    document.setText(source)
    return document.semantics().root
  } finally { document.dispose() }
}

function cellText(cell) {
  return cell.children.map(node => node.value ?? '').join('')
}

const exactHeader = '`>a | b |\n|---|---|\n **see\r\n_ded'
const exactDefinition = '| a | b |\n|---|---|\n[x]:* [x]: /target\n| a | *b |\n|---|---|\n*/```\n&\ud83e'
const lineEndings = source => [source, source.replaceAll('\r\n', '\n'), source.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')]

test('table recognition retains the exact unmatched-backtick development source', () => {
  for (const source of lineEndings(exactHeader)) {
    const root = snapshot(source)
    assert.equal(root.children.length, 1)
    const table = root.children[0]
    assert.equal(table.type, 'table', JSON.stringify(source))
    assert.deepEqual(table.range, { start: 0, end: source.length })
    assert.deepEqual(table.rows.map(row => row.cells.map(cellText)), [['`>a', 'b'], ['**see', ''], ['_ded', '']])
    assert.deepEqual(table.rows[0].cells[0].range, { start: 0, end: 4 })
    const inline = table.rows[0].cells[0].children[0]
    assert.deepEqual(inline.range, { start: 0, end: 3 })
    assert.equal(source.slice(inline.range.start, inline.range.end), '`>a')
    assert.deepEqual(snapshot(source, { gfm: false }).children.map(node => node.type), ['paragraph'])
  }
})

test('short fence-marker runs remain eligible table header text', () => {
  const headers = ['`a', '``a', '`', '``', '~a', '~~a', '`a`', '``a``']
  for (const header of headers) {
    for (const eol of ['\n', '\r\n']) {
      const table = snapshot(`${header}|b${eol}-|-`).children[0]
      assert.equal(table.type, 'table', header)
      assert.equal(table.rows[0].cells.length, 2)
      assert.deepEqual(table.rows[0].cells[0].range, { start: 0, end: header.length })
    }
  }
  const code = snapshot('`a`|b\n-|-').children[0].rows[0].cells[0].children[0]
  assert.equal(code.type, 'code')
  assert.equal(code.value, 'a')
  assert.equal(code.sourceValue, 'a')
  assert.deepEqual(code.range, { start: 0, end: 3 })
})

test('table body delimiter pairs and definition-like lines do not start another table', () => {
  for (const source of lineEndings(exactDefinition).concat(['a|b\n-|-\nc|d\n-|-', 'a|b\n-|-\n[x]: /url\nc|d\n-|-'])) {
    const root = snapshot(source)
    assert.equal(root.children.length, 1, JSON.stringify(source))
    const table = root.children[0]
    assert.equal(table.type, 'table')
    assert.deepEqual(table.range, { start: 0, end: source.length })
    assert.equal(table.rows.at(-1).cells.length, 2)
  }
  const table = snapshot(exactDefinition).children[0]
  assert.deepEqual(table.rows.map(row => row.cells.map(cellText)), [['a', 'b'], ['[x]:* [x]: /target', ''], ['a', '*b'], ['---', '---'], ['*/```', ''], ['&\ud83e', '']])
})

test('real code fences and invalid table delimiters keep their block precedence', () => {
  for (const marker of ['```', '~~~']) {
    for (const eol of ['\n', '\r\n']) {
      const root = snapshot(`${marker}a|b${eol}-|-${eol}${marker}`)
      assert.deepEqual(root.children.map(node => node.type), ['code'])
      assert.equal(root.children[0].value, '-|-')
    }
  }
  assert.equal(snapshot('`a|b\n---').children[0].type, 'heading')
  for (const source of ['`a|b\n-|x', '``a|b\n-|-|-', '`a\\|b\n-|-']) {
    assert.equal(snapshot(source).children[0].type, 'paragraph', source)
  }
  assert.equal(semanticHtml({ root: snapshot('`a`|b\n-|-') }), '<table>\n<thead>\n<tr>\n<th><code>a</code></th>\n<th>b</th>\n</tr>\n</thead>\n</table>\n')
})

test('table recognition edits and undo equal a fresh native parse', () => {
  const document = new MarkdownDocument()
  try {
    document.setText(exactHeader)
    for (const prefix of ['`', '', '``', '']) {
      document.edit(0, 0, prefix)
      const source = prefix + exactHeader
      assert.deepEqual(document.semantics().root, snapshot(source))
      document.edit(0, prefix.length, '')
      assert.deepEqual(document.semantics().root, snapshot(exactHeader))
    }
  } finally { document.dispose() }
})

const fenceLengths = [3, 255, 256, 257, 258, 259, 511, 512, 65535, 65536, 65537]

function checkFenceClassification(marker, length, eol) {
  const fence = marker.repeat(length)
  const source = `${fence}a|b${eol}-|-${eol}${fence}`
  const root = snapshot(source)
  assert.deepEqual(root.children.map(node => node.type), ['code'], `${marker} x ${length}`)
  assert.equal(root.children[0].value, '-|-')
  assert.deepEqual(root.children[0].range, { start: 0, end: source.length })
}

test('long real fences never wrap into short-marker table dispatch', () => {
  for (const marker of ['`', '~']) {
    for (const length of fenceLengths) {
      checkFenceClassification(marker, length, '\n')
      checkFenceClassification(marker, length, '\r\n')
    }
  }
})

function checkFenceClose(marker, length, closingLength) {
  const closing = marker.repeat(closingLength)
  const source = `${marker.repeat(length)}info\nbody\n${closing}\ntail`
  const root = snapshot(source)
  const closes = closingLength >= length
  assert.deepEqual(root.children.map(node => node.type), closes ? ['code', 'paragraph'] : ['code'], `${marker} ${length}/${closingLength}`)
  assert.equal(root.children[0].value, closes ? 'body' : `body\n${closing}\ntail`)
  assert.equal(root.children[0].range.end, closes ? source.length - 5 : source.length)
}

test('long fences close only with an equal or longer run of the same marker', () => {
  for (const marker of ['`', '~']) {
    for (const length of fenceLengths) {
      checkFenceClose(marker, length, length - 1)
      checkFenceClose(marker, length, length)
      checkFenceClose(marker, length, length + 1)
    }
  }
})

function checkFenceEdits(marker, length) {
  let source = `${marker.repeat(length)}info\nbody\n${marker.repeat(length - 1)}\ntail`
  const document = new MarkdownDocument()
  const edit = (start, end, inserted) => {
    document.edit(start, end, inserted)
    source = source.slice(0, start) + inserted + source.slice(end)
    assert.deepEqual(document.semantics().root, snapshot(source))
    document.reparse()
    assert.deepEqual(document.semantics().root, snapshot(source))
    assert.equal(document.presentation({ input: 'ended' }).source, source)
  }
  try {
    document.setText(source)
    const bodyStart = length + 5
    edit(bodyStart, bodyStart + 4, 'edited')
    const closeStart = source.indexOf(marker.repeat(length - 1), bodyStart)
    edit(closeStart, closeStart, marker)
    assert.deepEqual(document.semantics().root.children.map(node => node.type), ['code', 'paragraph'])
    edit(0, 0, marker)
    assert.deepEqual(document.semantics().root.children.map(node => node.type), ['code'])
    edit(0, 1, '')
    edit(closeStart, closeStart + 1, '')
    assert.deepEqual(document.semantics().root.children.map(node => node.type), ['code'])
  } finally { document.dispose() }
}

test('long fence state survives incremental body, closing and opening edits', () => {
  for (const marker of ['`', '~']) {
    for (const length of [255, 256, 257, 258, 259, 512, 65536]) {
      checkFenceEdits(marker, length)
    }
  }
})
