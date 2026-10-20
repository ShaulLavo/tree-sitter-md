import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import type { SemanticBlock, SemanticListItem } from '../js/semantic.js'
import { semanticHtml } from './semantic-html.mjs'

await init()
type Case = { id: string; source: string; oracleHtml: string; utf16LeSha256: string }
const cases: Case[] = JSON.parse(readFileSync(new URL('./fixtures/nested-definition-lists.json', import.meta.url), 'utf8'))
const profiles = [{ math: false, gfm: false }, { math: false, gfm: true },
  { math: true, gfm: false }, { math: true, gfm: true }]

function cleanItem(item: SemanticListItem): SemanticListItem {
  return { ...item, children: clean(item.children) }
}
function cleanBlock(block: SemanticBlock): SemanticBlock {
  if (block.type === 'quote') return { ...block, children: clean(block.children) }
  if (block.type === 'list') return { ...block, items: block.items.map(cleanItem) }
  return block
}
function clean(blocks: readonly SemanticBlock[]): SemanticBlock[] {
  return blocks.filter(block => block.type !== 'definition').map(cleanBlock)
}
function html(document: MarkdownDocument) {
  const root = document.semantics().root
  return semanticHtml({ root: { ...root, children: clean(root.children) } })
}
function state(document: MarkdownDocument, source: string) {
  const { revision: _semanticRevision, ...semantics } = document.semantics()
  const { revision: _openRevision, ...open } = document.presentation({ input: 'open' })
  const { revision: _endedRevision, ...ended } = document.presentation({ input: 'ended' })
  assert.equal(open.source, source)
  assert.equal(ended.source, source)
  return { semantics, open, ended,
    decorations: Array.from(document.decorations(0, source.length)),
    highlights: Array.from(document.highlights(0, source.length)),
    folds: Array.from(document.folds(0, source.length)),
    injections: Array.from(document.injections(0, source.length)) }
}
function same(document: MarkdownDocument, fresh: MarkdownDocument, source: string) {
  fresh.setText(source)
  assert.deepEqual(state(document, source), state(fresh, source))
}
function editUndo(document: MarkdownDocument, fresh: MarkdownDocument, source: string,
                  at: number, removed: number, inserted: string) {
  const edited = source.slice(0, at) + inserted + source.slice(at + removed)
  document.edit(at, at + removed, inserted)
  same(document, fresh, edited)
  document.edit(at, at + inserted.length, source.slice(at, at + removed))
  same(document, fresh, source)
}
function check(row: Case, profile: typeof profiles[number]) {
  const document = new MarkdownDocument(profile), fresh = new MarkdownDocument(profile)
  try {
    document.setText(row.source)
    assert.equal(html(document), row.oracleHtml)
    if (row.id.startsWith('lazy-definition/')) {
      const { root } = document.semantics()
      assert.deepEqual(document.presentation({ input: 'open' }).root, root)
      assert.deepEqual(document.presentation({ input: 'ended' }).root, root)
    }
    same(document, fresh, row.source)
    const line = row.source.indexOf('\n') + 1
    const ending = row.source.includes('\r\n') ? '\r\n' : '\n'
    editUndo(document, fresh, row.source, line, 0, ending)
    editUndo(document, fresh, row.source, line, 0, '  > ')
    const target = row.source.indexOf('/target')
    editUndo(document, fresh, row.source, target, 7, '/changed')
    const list = row.source.indexOf('- ')
    if (list >= 0) editUndo(document, fresh, row.source, list, 1, '1.')
    const tab = row.source.indexOf('\t')
    if (tab >= 0) editUndo(document, fresh, row.source, tab, 1, '    ')
    document.reparse()
    same(document, fresh, row.source)
    assert.equal(html(document), row.oracleHtml)
  } finally { document.dispose(); fresh.dispose() }
}
function checkStreaming(row: Case, profile: typeof profiles[number]) {
  const document = new MarkdownDocument(profile), fresh = new MarkdownDocument(profile)
  let source = ''
  try {
    document.setText(source)
    for (const character of row.source) {
      document.edit(source.length, source.length, character)
      source += character
      same(document, fresh, source)
    }
    assert.equal(html(document), row.oracleHtml)
  } finally { document.dispose(); fresh.dispose() }
}
for (const row of cases) test('nested definition list oracle ' + row.id, () => {
  assert.equal(createHash('sha256').update(Buffer.from(row.source, 'utf16le')).digest('hex'), row.utf16LeSha256)
  for (const profile of profiles) check(row, profile)
})
for (const row of cases.filter(row => /^(tab-lazy|spaces-separated)\//.test(row.id))) {
  test('nested definition list every-character schedule ' + row.id, () => {
    for (const profile of profiles) checkStreaming(row, profile)
  })
}
