import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import type { SemanticBlock } from '../js/semantic.js'

await init()
const cases: { id: string; mode: string; family: string; source: string; utf16LeSha256: string }[] =
  JSON.parse(readFileSync(new URL('./fixtures/block-interruption.json', import.meta.url), 'utf8'))

function snapshot(source: string, math: boolean) {
  const document = new MarkdownDocument({ gfm: true, cjk: true, math })
  try {
    document.setText(source)
    assert.equal(document.presentation({ input: 'ended' }).source, source)
    return document.semantics().root
  } finally { document.dispose() }
}

function verifyEmptyList(source: string, blocks: readonly SemanticBlock[]) {
  const offset = source.indexOf('\n- \n') + 1
  const list = blocks.find(block => block.range.start === offset)
  assert.equal(list?.type, 'list')
  if (list?.type !== 'list') throw new Error('expected empty list after quote')
  assert.equal(list.items.length, 1)
  assert.deepEqual(list.items[0].children, [])
}

for (const row of cases) test('exact block interruption ' + row.id, () => {
  assert.equal(createHash('sha256').update(Buffer.from(row.source, 'utf16le')).digest('hex'), row.utf16LeSha256)
  for (const math of [false, true]) verifyEmptyList(row.source, snapshot(row.source, math).children)
})

test('definition paragraph state ends with its quote, not inside it', () => {
  for (const eol of ['\n', '\r\n']) {
    const outside = snapshot(`> [x]: /target${eol}- ${eol}${eol}[x]`, false)
    assert.deepEqual(outside.children.map(block => block.type), ['quote', 'list', 'paragraph'])
    const inside = snapshot(`> [x]: /target${eol}> - ${eol}${eol}[x]`, false)
    const quote = inside.children[0]
    assert.equal(quote?.type, 'quote')
    if (quote?.type !== 'quote') throw new Error('expected quote')
    assert.deepEqual(quote.children.map(block => block.type), ['definition', 'paragraph'])
    assert.deepEqual(snapshot(`[x]: /target${eol}- ${eol}${eol}[x]`, false).children.map(block => block.type), ['definition', 'paragraph', 'paragraph'])
  }
})

function readState(document: MarkdownDocument, source: string) {
  const ended = document.presentation({ input: 'ended' })
  const open = document.presentation({ input: 'open' })
  assert.equal(ended.source, source)
  assert.equal(open.source, source)
  return {
    exact: document.semantics().root,
    ended: { root: ended.root, provisional: ended.provisional, suppressed: ended.suppressed, references: ended.references },
    open: { root: open.root, provisional: open.provisional, suppressed: open.suppressed, references: open.references },
    decorations: Array.from(document.decorations(0, source.length)),
    highlights: Array.from(document.highlights(0, source.length)),
    folds: Array.from(document.folds(0, source.length)),
    injections: Array.from(document.injections(0, source.length)),
  }
}

function verifyEdits(source: string, math: boolean) {
  const document = new MarkdownDocument({ gfm: true, cjk: true, math })
  const fresh = new MarkdownDocument({ gfm: true, cjk: true, math })
  const at = source.indexOf('\n- \n') + 1
  try {
    document.setText(source)
    for (const marker of ['+', '*', '-']) {
      const edited = source.slice(0, at) + marker + source.slice(at + 1)
      document.edit(at, at + 1, marker)
      fresh.setText(edited)
      assert.deepEqual(readState(document, edited), readState(fresh, edited))
      document.reparse()
      assert.deepEqual(readState(document, edited), readState(fresh, edited))
    }
    verifyEmptyList(source, document.semantics().root.children)
  } finally { document.dispose(); fresh.dispose() }
}

for (const row of cases) test('definition container edits and reparse ' + row.id, () => {
  for (const math of [false, true]) verifyEdits(row.source, math)
})
