import assert from 'node:assert/strict'
import { test } from 'node:test'
import spec from '../bench/node_modules/commonmark-spec/index.js'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { init, MarkdownDocument } from '../js/index.js'
import { decodeSemanticRoot } from '../js/semantic.js'
import { semanticHtml } from './semantic-html.mjs'

await init()

function snapshot(source, options) {
  const doc = new MarkdownDocument(options)
  try { doc.setText(source); return doc.semantics() }
  finally { doc.dispose() }
}

for (const example of spec.tests) test(`semantic CommonMark ${example.number} ${example.section}`, () => {
  assert.equal(semanticHtml(snapshot(example.markdown.replaceAll('→', '\t'), { gfm: false })), example.html.replaceAll('→', '\t'))
})

const gfm = readFileSync(new URL('../bench/spec/gfm-spec.txt', import.meta.url), 'utf8').replace(/\r\n?/g, '\n').split('<!-- END TESTS -->')[0]
const differences = JSON.parse(readFileSync(new URL('./semantic-gfm-differences.json', import.meta.url), 'utf8'))
const sha256 = value => createHash('sha256').update(value).digest('hex')
let exampleNumber = 0
for (const match of gfm.matchAll(/^`{32} example(?: \w+)?\n([\s\S]*?)^\.\n([\s\S]*?)^`{32}$/gm)) {
  const number = ++exampleNumber
  test(`semantic GFM ${number}`, () => {
    const source = match[1].replaceAll('→', '\t'), expected = match[2].replaceAll('→', '\t')
    const actual = semanticHtml(snapshot(source))
    const difference = differences.find(value => value.id === number)
    if (!difference) { assert.equal(actual, expected); return }
    assert.equal(sha256(source), difference.sourceSha256)
    assert.equal(sha256(expected), difference.expectedSha256)
    assert.equal(sha256(actual), difference.actualSha256)
    assert.equal(actual, difference.actualHtml, difference.reason)
  })
}

test('semantic buffers own decoded payloads and survive edits/disposal', () => {
  const doc = new MarkdownDocument()
  doc.setText('> 3. **Hi &amp; [x](</a&b> "t&amp;u")**\n')
  const before = doc.semantics()
  const original = JSON.stringify(before)
  assert.equal(before.root.children[0].children[0].start, 3)
  doc.edit(0, 0, 'Earlier\n\n')
  assert.equal(doc.semantics().revision, before.revision + 1)
  doc.dispose(); doc.dispose()
  assert.equal(JSON.stringify(before), original)
  assert.throws(() => doc.semantics(), /disposed/)
  assert.throws(() => doc.edit(0, 0, 'x'), /disposed/)
  assert.throws(() => doc.setText('x'), /disposed/)
})
test('invalid edits fail before native source mutation', () => {
  const doc = new MarkdownDocument(); doc.setText('source')
  try {
    for (const bounds of [[-1, 0], [0, 7], [3, 2], [0.5, 1]]) assert.throws(() => doc.edit(...bounds, 'x'))
    assert.equal(semanticHtml(doc.semantics()), '<p>source</p>\n')
  } finally { doc.dispose() }
})

test('semantic tables keep every alignment and pad short rows', () => {
  const head = Array.from({ length: 40 }, (_, i) => `h${i}`).join('|')
  const delimiter = Array.from({ length: 40 }, (_, i) => i % 2 ? '---:' : ':---').join('|')
  const table = snapshot(`${head}\n${delimiter}\na|b`).root.children[0]
  assert.equal(table.align.length, 40)
  assert.equal(table.align[39], 'right')
  assert.equal(table.rows[1].cells.length, 40)
  assert.equal(table.rows[1].cells[39].children.length, 0)
})
test('header-only tables recognize complete one-dash delimiter cells at EOF', () => {
  for (const source of ['| Name | Value |\n| --- | -', '| Name | Value |\n| --- | -:']) {
    const table = snapshot(source).root.children[0]
    assert.equal(table.type, 'table')
    assert.equal(table.rows.length, 1)
    assert.equal(table.rows[0].cells.length, 2)
  }
  assert.equal(snapshot('| Name | Value |\n| --- | :').root.children[0].type, 'paragraph')
})

test('semantic result validation rejects invalid ranges and metadata', () => {
  const good = snapshot('text').root
  assert.deepEqual(decodeSemanticRoot(JSON.stringify(good), 4), good)
  assert.throws(() => decodeSemanticRoot(JSON.stringify({ ...good, range: { start: 0, end: 5 } }), 4))
  assert.throws(() => decodeSemanticRoot(JSON.stringify({ ...good, children: [{ type: 'heading', range: { start: 0, end: 4 }, depth: 7, children: [] }] }), 4))
})

test('semantic incremental updates equal a fresh semantic parse', () => {
  const source = '[ref]\n\n> 3. **Hi**\n\na|b\n---|---\nx|y'
  const doc = new MarkdownDocument(); doc.setText(source)
  try {
    doc.edit(source.length, source.length, '\n\n[ref]: /url "title"')
    assert.deepEqual(doc.semantics().root, snapshot(source + '\n\n[ref]: /url "title"').root)
    doc.edit(0, 5, '**x**')
    assert.deepEqual(doc.semantics().root, snapshot('**x**' + source.slice(5) + '\n\n[ref]: /url "title"').root)
  } finally { doc.dispose() }
})
