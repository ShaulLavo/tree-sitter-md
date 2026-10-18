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
    assert.deepEqual(table.rows[0].cells[0].range, { start: 0, end: 3 })
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
