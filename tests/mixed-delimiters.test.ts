import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import { semanticHtml } from './semantic-html.mjs'

await init()
// Captured through Fregat's remark attention, GFM and CJK strikethrough plugins.
const fixtures: readonly { readonly source: string; readonly html: string }[] =
  JSON.parse(readFileSync(new URL('./fixtures/mixed-delimiters.json', import.meta.url), 'utf8'))

function snapshots(document: MarkdownDocument) {
  return [document.semantics(), document.presentation({ input: 'open' }),
    document.presentation({ input: 'ended' })]
}

function check(source: string, html: string, math: boolean): void {
  const document = new MarkdownDocument({ gfm: true, cjk: true, math })
  try {
    document.setText(source + '\n\n')
    for (const snapshot of snapshots(document)) assert.equal(semanticHtml(snapshot), html)
    document.edit(0, 0, 'prefix ')
    document.edit(0, 7, '')
    for (const snapshot of snapshots(document)) assert.equal(semanticHtml(snapshot), html)
  } finally { document.dispose() }
}

for (const { source, html } of fixtures) {
  test('mixed delimiter ownership: ' + JSON.stringify(source), () => {
    check(source, html, false)
    check(source, html, true)
  })
}
