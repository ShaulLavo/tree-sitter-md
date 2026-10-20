import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import { semanticHtml } from './semantic-html.mjs'
import type { PresentationBlock, SemanticBlock } from '../js/semantic.js'

await init()
const cases: { id: string; source: string; sourceIdentity: { utf16Units: number; utf16LeSha256: string }; oracleGfmHtml: string }[] =
  JSON.parse(readFileSync(new URL('./fixtures/pipe-table-header.json', import.meta.url), 'utf8'))
const controls: { source: string; html: string }[] =
  JSON.parse(readFileSync(new URL('./fixtures/pipe-table-controls.json', import.meta.url), 'utf8'))

function snapshot(document: MarkdownDocument, source: string) {
  const { revision, ...exact } = document.semantics()
  const { revision: openRevision, ...open } = document.presentation({ input: 'open' })
  const { revision: endedRevision, ...ended } = document.presentation({ input: 'ended' })
  assert.equal(open.source, source)
  assert.equal(ended.source, source)
  return { exact, open, ended, decorations: Array.from(document.decorations(0, source.length)),
    highlights: Array.from(document.highlights(0, source.length)), folds: Array.from(document.folds(0, source.length)),
    injections: Array.from(document.injections(0, source.length)) }
}

function fresh(source: string, math: boolean, gfm = true) {
  const document = new MarkdownDocument({ gfm, cjk: true, math })
  try {
    document.setText(source)
    return snapshot(document, source)
  } finally { document.dispose() }
}

function assertTable(blocks: readonly (SemanticBlock | PresentationBlock)[], start: number) {
  const table = blocks.find(block => block.type === 'table')
  assert.ok(table?.type === 'table')
  assert.equal(table.range.start, start)
  assert.equal(table.rows[0].cells.length, 1)
}

for (const row of cases) test('saved pipe-table witness ' + row.id, () => {
  assert.equal(row.source.length, row.sourceIdentity.utf16Units)
  assert.equal(createHash('sha256').update(Buffer.from(row.source, 'utf16le')).digest('hex'), row.sourceIdentity.utf16LeSha256)
  for (const math of [false, true]) checkWitness(row, math)
})

function checkWitness(row: (typeof cases)[number], math: boolean) {
  const result = fresh(row.source, math)
  if (row.id.startsWith('219/')) {
    assert.equal(semanticHtml(result.exact), row.oracleGfmHtml)
    assert.deepEqual(result.exact.root.children.map(block => block.type), ['paragraph', 'quote'])
    return
  }
  for (const root of [result.exact.root, result.open.root, result.ended.root]) {
    assertTable(root.children, row.source.indexOf('\n') + 1)
  }
}

for (const row of controls) test('pinned GFM table control ' + JSON.stringify(row.source), () => {
  for (const math of [false, true]) assert.equal(semanticHtml(fresh(row.source, math).exact), row.html)
})

const valid = ['b\n|---|', 'a\nb\n|---|', 'a\n|b\n|---|', '|b\n|---|', 'b|\n|---|', 'b\n|---', '`b\n|---|', '``\n|---|', 'b\\|c\n|---|']
for (const source of valid) test('optional edge pipes ' + JSON.stringify(source), () => {
  for (const math of [false, true]) assertTable(fresh(source, math).exact.root.children, source.startsWith('a\n') ? 2 : 0)
})

const invalid = ['b\n---', 'b\n--', ' \n|---|', '|\n|---|', 'b\n|x|', 'b|c\n|---|', 'b\n|---|---|', '```b\n|---|\n```', '    b\n    |---|']
for (const source of invalid) test('non-table control ' + JSON.stringify(source), () => {
  for (const math of [false, true]) assert.ok(fresh(source, math).exact.root.children.every(block => block.type !== 'table'))
})

function checkEdits(source: string, math: boolean) {
  const document = new MarkdownDocument({ gfm: true, cjk: true, math })
  let current = source
  const edit = (start: number, end: number, inserted: string) => {
    document.edit(start, end, inserted)
    current = current.slice(0, start) + inserted + current.slice(end)
    assert.deepEqual(snapshot(document, current), fresh(current, math))
    document.reparse()
    assert.deepEqual(snapshot(document, current), fresh(current, math))
  }
  try {
    document.setText(current)
    const offset = current.indexOf('|---')
    if (offset >= 0) {
      edit(offset + 1, offset + 2, 'x')
      edit(offset + 1, offset + 2, '-')
    }
    edit(0, 0, 'before\n')
    edit(0, 7, '')
    assert.deepEqual(snapshot(document, current), fresh(source, math))
  } finally { document.dispose() }
}

for (const math of [false, true]) test('fresh and incremental table state, profile ' + math, () => {
  for (const source of valid.concat(invalid, cases.map(row => row.source), controls.map(row => row.source))) checkEdits(source, math)
})

for (const eol of ['\n', '\r\n']) test('line endings and CommonMark isolation ' + JSON.stringify(eol), () => {
  for (const math of [false, true]) {
    assertTable(fresh(`a${eol}b${eol}|---|`, math).exact.root.children, eol.length + 1)
    assert.deepEqual(fresh(`b${eol}|---|`, math, false).exact.root.children.map(block => block.type), ['paragraph'])
  }
})

for (const source of ['a|b\n|---\nx\nb\n|---|', '> a|b\n> |---\n> b\n> |---|']) {
  test('a rejected delimiter keeps its paragraph through later candidates ' + JSON.stringify(source), () => {
    for (const math of [false, true]) {
      assert.equal(semanticHtml(fresh(source, math).exact).includes('<table>'), false)
      checkEdits(source, math)
    }
  })
}

for (const source of ['a|b\n|---\n\nb\n|---|', '> a|b\n> |---\n\nb\n|---|']) {
  test('table rejection ends with its paragraph ' + JSON.stringify(source), () => {
    for (const math of [false, true]) {
      assertTable(fresh(source, math).exact.root.children, source.lastIndexOf('b\n'))
      checkEdits(source, math)
    }
  })
}

for (const source of ['b\n---', 'b|\n---', '`b\n--']) test('pipe-free underline stays a setext heading ' + JSON.stringify(source), () => {
  for (const math of [false, true]) assert.deepEqual(fresh(source, math).exact.root.children.map(block => block.type), ['heading'])
})

for (const delimiter of ['---|---', ':---|---:', '|---|---|', '| :--- | ---: |']) {
  const source = 'a\n' + delimiter + '\nb\n|---|'
  test('a mismatched delimiter disables later table candidates ' + JSON.stringify(delimiter), () => {
    for (const math of [false, true]) {
      assert.deepEqual(fresh(source, math).exact.root.children.map(block => block.type), ['paragraph'])
      checkEdits(source, math)
    }
  })
}

for (const source of ['b\n||', 'b\n| |', 'b\n|:|', 'a|b\n|-||', 'a|b\n||-|']) {
  test('every delimiter cell needs a dash ' + JSON.stringify(source), () => {
    for (const math of [false, true]) assert.ok(fresh(source, math).exact.root.children.every(block => block.type !== 'table'))
  })
}
