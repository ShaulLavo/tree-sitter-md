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

test('ordinary emphasis preserves a remaining opener after a one-marker match', () => {
  const source = '**`x` d*$x$$*_x$*'
  assert.deepEqual(snapshot(source, { gfm: false }).root.children[0].children, [
    { type: 'emphasis', range: { start: 0, end: 13 }, children: [
      { type: 'emphasis', range: { start: 1, end: 8 }, children: [
        { type: 'code', range: { start: 2, end: 5 }, value: 'x' },
        { type: 'text', range: { start: 5, end: 7 }, value: ' d' },
      ] },
      { type: 'text', range: { start: 8, end: 12 }, value: '$x$$' },
    ] },
    { type: 'text', range: { start: 13, end: 14 }, value: '_' },
    { type: 'text', range: { start: 14, end: 16 }, value: 'x$' },
    { type: 'text', range: { start: 16, end: 17 }, value: '*' },
  ])
})
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
test('streaming EOF prefixes preserve syntax and authored source ranges', () => {
  const setext = snapshot('Summary\n===').root.children[0]
  assert.equal(setext.type, 'heading')
  assert.equal(setext.depth, 1)
  for (const source of ['```', '```js\n', '~~~']) {
    const code = snapshot(source).root.children[0]
    assert.equal(code.type, 'code')
    assert.equal(code.value, '')
    assert.equal(code.range.end, source.length)
  }
  const quote = snapshot('> - first\n>').root.children[0]
  assert.equal(quote.children[0].range.end, 11)
  const quotedFence = snapshot('> ```js\n>').root.children[0].children[0]
  assert.equal(quotedFence.type, 'code')
  assert.equal(quotedFence.range.end, 8)
  const indented = snapshot('    first\n    ').root.children[0]
  assert.equal(indented.value, 'first')
  assert.equal(indented.range.end, 14)
  for (const source of ['    ', '\t']) assert.equal(snapshot(source).root.children.length, 0)
  assert.equal(snapshot('\ufeff#').root.children[0].type, 'heading')
})
test('quoted open fences preserve their final authored content position while streaming', () => {
  for (const [source, end] of [
    ['> ```js\n', 7],
    ['> ```js\r\n', 7],
    ['> ```js\n>', 8],
    ['> ```js\n> ', 8],
    ['> ```js\n>  ', 11],
    ['> ```js\n> \n', 10],
    ['> ```js\n> \n>', 11],
    ['> ```js\n> x\n', 11],
    ['> ```js\n> x\n>\n', 13],
  ]) {
    const code = snapshot(source).root.children[0].children[0]
    assert.equal(code.range.end, end, source)
  }
  const item = snapshot('- ```js\n  ').root.children[0].items[0]
  assert.equal(item.children[0].range.end, 8)
})
test('task-like link labels stay ordinary list content', () => {
  const item = snapshot('- [x](streamdown:incomplete-link)').root.children[0].items[0]
  assert.equal(item.checked, null)
  assert.equal(item.children[0].children[0].type, 'link')
  assert.equal(item.children[0].children[0].url, 'streamdown:incomplete-link')
  const incomplete = snapshot('- [ ]').root.children[0].items[0]
  assert.equal(incomplete.checked, null)
  assert.equal(incomplete.children[0].children[0].value, '[ ]')
  const complete = snapshot('- [x] done').root.children[0].items[0]
  assert.equal(complete.checked, true)
  assert.equal(complete.children[0].children[0].value, 'done')
})
test('UTF-16 stream fragments preserve authored lone units and genuine replacement characters', () => {
  for (const unit of ['\ud83d', '\udc00']) {
    const text = snapshot(`&#xD83D; ${unit} �`).root.children[0].children.map(node => node.value).join('')
    assert.equal(text, `� ${unit} �`)
    assert.equal(snapshot(unit).root.children[0].children[0].value, unit)
    assert.equal(snapshot('`' + unit + '`').root.children[0].children[0].value, unit)
    assert.equal(snapshot('```\n' + unit + '\n```').root.children[0].value, unit)
    assert.equal(snapshot('![' + unit + '](x)').root.children[0].children[0].alt, unit)
    assert.equal(snapshot('<div>' + unit + '</div>').root.children[0].value, '<div>' + unit + '</div>')
  }
  assert.equal(snapshot('&#xD83D;').root.children[0].children[0].value, '�')
  assert.equal(snapshot('�').root.children[0].children[0].value, '�')
  assert.equal(snapshot('😀').root.children[0].children[0].value, '😀')
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
