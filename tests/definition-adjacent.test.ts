import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import type { SemanticBlock, SemanticListItem } from '../js/semantic.js'
import { semanticHtml } from './semantic-html.mjs'

await init()
const cases: { id: string; source: string; oracleHtml: string; utf16LeSha256: string }[] =
  JSON.parse(readFileSync(new URL('./fixtures/definition-adjacent.json', import.meta.url), 'utf8'))

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

function state(document: MarkdownDocument, source: string) {
  const { revision: semanticRevision, ...semantics } = document.semantics()
  const { revision: openRevision, ...open } = document.presentation({ input: 'open' })
  const { revision: endedRevision, ...ended } = document.presentation({ input: 'ended' })
  assert.equal(open.source, source)
  assert.equal(ended.source, source)
  return { semantics, open, ended,
    decorations: Array.from(document.decorations(0, source.length)),
    highlights: Array.from(document.highlights(0, source.length)),
    folds: Array.from(document.folds(0, source.length)),
    injections: Array.from(document.injections(0, source.length)) }
}

function check(row: typeof cases[number], math: boolean, gfm: boolean) {
  const document = new MarkdownDocument({ math, gfm })
  const fresh = new MarkdownDocument({ math, gfm })
  try {
    document.setText(row.source)
    const root = document.semantics().root
    assert.equal(semanticHtml({ root: { ...root, children: clean(root.children) } }), row.oracleHtml)
    const initial = state(document, row.source)
    const at = row.source.indexOf('\n') + 1
    const edited = row.source.slice(0, at) + '\n' + row.source.slice(at)
    document.edit(at, at, '\n')
    fresh.setText(edited)
    assert.deepEqual(state(document, edited), state(fresh, edited))
    document.edit(at, at + 1, '')
    assert.deepEqual(state(document, row.source), initial)
    document.reparse()
    assert.deepEqual(state(document, row.source), initial)
  } finally { document.dispose(); fresh.dispose() }
}

for (const row of cases) test('definition continuation oracle ' + row.id, () => {
  assert.equal(createHash('sha256').update(Buffer.from(row.source, 'utf16le')).digest('hex'), row.utf16LeSha256)
  for (const profile of [{ math: false, gfm: false }, { math: false, gfm: true }, { math: true, gfm: false }, { math: true, gfm: true }]) {
    check(row, profile.math, profile.gfm)
  }
})
