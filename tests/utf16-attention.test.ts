import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { init, Kind, MarkdownDocument } from '../js/index.js'
import type { SemanticRange } from '../js/semantic.js'

await init()
type Attention = readonly [string, number, number]
type Node = { readonly type: string; readonly range: SemanticRange | null;
  readonly children?: readonly Node[]; readonly items?: readonly Node[];
  readonly rows?: readonly Node[]; readonly cells?: readonly Node[] }
const options = { gfm: true, cjk: true, math: true }
const tags: Readonly<Record<string, string>> = { emphasis: 'em', strong: 'strong', delete: 'del' }
const kinds: Readonly<Record<number, string>> = { [Kind.Emphasis]: 'em', [Kind.Strong]: 'strong', [Kind.Strikethrough]: 'del' }
function attention(node: Node): Attention[] {
  const own: Attention[] = []
  if (tags[node.type] && node.range) own.push([tags[node.type], node.range.start, node.range.end])
  const children = (node.children ?? []).concat(node.items ?? [], node.rows ?? [], node.cells ?? [])
  return own.concat(children.flatMap(attention))
}
function decorations(document: MarkdownDocument, length: number): Attention[] {
  const records = document.decorations(0, length)
  const result: Attention[] = []
  for (let i = 0; i < records.length; i += 4) {
    if (kinds[records[i + 2]]) result.push([kinds[records[i + 2]], records[i], records[i + 1]])
  }
  return result
}
function ordered(rows: readonly Attention[]): Attention[] {
  return rows.toSorted((a, b) => a[1] - b[1] || b[2] - a[2] || a[0].localeCompare(b[0]))
}
function check(document: MarkdownDocument, source: string, expected: readonly Attention[]): void {
  assert.deepEqual(attention(document.semantics().root), expected)
  assert.deepEqual(attention(document.presentation({ input: 'ended' }).root), expected)
  assert.deepEqual(ordered(decorations(document, source.length)), ordered(expected))
  assert.equal(document.presentation({ input: 'open' }).source, source)
  assert.equal(document.presentation({ input: 'ended' }).source, source)
}
function sample(source: string, expected: readonly Attention[], cjk = true): void {
  const document = new MarkdownDocument({ ...options, cjk })
  try {
    document.setText(source)
    check(document, source, expected)
  } finally { document.dispose() }
}

test('known-good attention uses both native inline producers', () => sample('**ok**', [['strong', 0, 6]]))

for (const cjk of [true, false]) {
  test(`original 2/4/2 run selection with lone high and low neighbors cjk=${cjk}`, () => {
    sample('**a/****b**\ud83e', [['strong', 0, 11]], cjk)
    sample('**a/****b**\uddd1', [['strong', 0, 11]], cjk)
  })
  test(`partial consumed run retains original length with lone neighbor cjk=${cjk}`, () => {
    sample('**a*)b*\ud83e', [['em', 1, 4]], cjk)
    sample('**a*)b*\uddd1', [['em', 1, 4]], cjk)
  })
  test(`genuine replacement character keeps its punctuation category cjk=${cjk}`, () => {
    sample('**a/****b**\ufffd', [['strong', 6, 11]], cjk)
  })
  test(`supplementary pair remains a scalar cjk=${cjk}`, () => {
    sample('**a/****b**🧑', [['strong', 6, 11]], cjk)
  })
  test(`lone units before an opener do not become punctuation cjk=${cjk}`, () => {
    sample('\ud83e**[x]**', [], cjk)
    sample('\uddd1**[x]**', [], cjk)
    sample('\ufffd**[x]**', [['strong', 1, 8]], cjk)
  })
}

type Saved = { readonly seed: number; readonly live: boolean; readonly revision: number;
  readonly rawPointer: string; readonly source: string; readonly expectedAttention: readonly Attention[];
  readonly sourceIdentity: { readonly utf16Units: number; readonly utf16LeSha256: string } }
const saved: readonly Saved[] = JSON.parse(readFileSync(new URL('./fixtures/utf16-attention-originals.json', import.meta.url), 'utf8'))
for (const row of saved) {
  test(`saved original allocation ${row.rawPointer} seed${row.seed} live=${row.live}`, () => {
    assert.equal(row.source.length, row.sourceIdentity.utf16Units)
    assert.equal(createHash('sha256').update(Buffer.from(row.source, 'utf16le')).digest('hex'), row.sourceIdentity.utf16LeSha256)
    const document = new MarkdownDocument(options)
    try {
      document.setText(row.source)
      check(document, row.source, row.expectedAttention)
      document.setText('')
      document.edit(0, 0, row.source)
      check(document, row.source, row.expectedAttention)
      document.reparse()
      check(document, row.source, row.expectedAttention)
    } finally { document.dispose() }
  })
}
