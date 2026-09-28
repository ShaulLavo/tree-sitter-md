import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { init, MarkdownDocument, Kind } from '../js/index.js'

await init({ resolver: process.env.WASM ? readFileSync(process.env.WASM) : undefined })

for (const gfm of [false, true]) {
  for (const warm of [false, true]) {
    for (const idle of [false, true]) {
      for (const prefix of ['', '\n\n', '# Title\n\n', 'intro\n\n']) {
        for (const suffix of ['', '\n', '\n\nTail **bold**\n']) {
          test(`reference boundary gfm=${gfm} warm=${warm} idle=${idle} prefix=${JSON.stringify(prefix)} suffix=${JSON.stringify(suffix)}`, () => {
            const before = prefix + '[ref]\n>[ref]:o' + suffix
            const after = prefix + '[ref]\n\n[ref]:o' + suffix
            const incremental = new MarkdownDocument({ gfm })
            const fresh = new MarkdownDocument({ gfm })
            try {
              incremental.setText(before)
              if (warm) incremental.decorations(0, before.length)
              if (idle) incremental.reparse()
              for (const [replacement, expectedText] of [['\n', after], ['>', before]]) {
                incremental.edit(prefix.length + 6, prefix.length + 7, replacement)
                fresh.setText(expectedText)
                const records = fresh.decorations(0, expectedText.length)
                let hasReference = false
                for (let i = 0; i < records.length; i += 4) {
                  if (records[i] === prefix.length && records[i + 1] === prefix.length + 5 && records[i + 2] === Kind.Link)
                    hasReference = true
                }
                assert(hasReference, 'The fresh oracle must actually resolve the reference link')
                for (const method of ['decorations', 'highlights', 'folds', 'injections']) {
                  assert.deepEqual(incremental[method](0, expectedText.length), fresh[method](0, expectedText.length), method)
                }
                assert.equal(incremental.lineCount, fresh.lineCount)
                for (let row = 0; row <= fresh.lineCount; row++)
                  assert.equal(incremental.rowStart(row), fresh.rowStart(row))
              }
            } finally {
              incremental.dispose()
              fresh.dispose()
            }
          })
        }
      }
    }
  }
}

test('a viewport starting in a hidden blank line still visits later paragraphs', () => {
  const doc = new MarkdownDocument()
  try {
    const text = 'one\n\ntwo\n\nthree\n'
    doc.setText(text)
    assert.deepEqual(Array.from(doc.decorations(4, text.length)), [
      5, 8, Kind.Paragraph, 0,
      10, 15, Kind.Paragraph, 0,
    ])
  } finally {
    doc.dispose()
  }
})
