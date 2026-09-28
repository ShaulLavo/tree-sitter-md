// Run with --check to reject viewport cost that grows with document position.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { init, MarkdownDocument, Kind } from '../js/index.js'

await init(process.env.WASM ? { inline: readFileSync(process.env.WASM) } : undefined)

const paragraph = 'A paragraph with **bold**, *emphasis*, and [a link](https://example.com).\n\n'
const count = Math.ceil(1_000_000 / paragraph.length)
const text = paragraph.repeat(count) + 'end\n'
const doc = new MarkdownDocument()

function measure(from) {
  for (let i = 0; i < 100; i++) doc.decorations(from, from + 4000)
  const samples = []
  for (let i = 0; i < 41; i++) {
    const start = performance.now()
    for (let j = 0; j < 20; j++) doc.decorations(from, from + 4000)
    samples.push((performance.now() - start) / 20)
  }
  return samples.sort((a, b) => a - b)[20]
}

try {
  doc.setText(text)
  const results = [0.1, 0.5, 0.95].map(fraction => {
    const blank = Math.floor(count * fraction) * paragraph.length - 1
    assert.equal(text[blank], '\n')
    assert.equal(text[blank - 1], '\n')
    const records = doc.decorations(blank, blank + 4000)
    assert(records.length > 0, 'Blank-line viewport must produce decorations')
    assert.deepEqual(Array.from(records.slice(0, 4)), [
      blank + 1, blank + paragraph.length - 1, Kind.Paragraph, 0,
    ])
    return {
      percent: fraction * 100,
      blankMs: measure(blank),
      paragraphMs: measure(blank + 1),
    }
  })
  console.log(JSON.stringify({ bytes: text.length, samples: 41, callsPerSample: 20, results }, null, 2))
  if (process.argv.includes('--check')) {
    // Allow scheduler/timer noise while rejecting a scan of all preceding blocks.
    assert(results[2].blankMs < results[0].blankMs * 3 + 0.02,
      'Deep blank-line viewport cost must stay near the early viewport cost')
    assert(results[2].blankMs < results[2].paragraphMs * 5 + 0.02,
      'Deep blank-line viewport cost must stay near a neighboring paragraph')
  }
} finally {
  doc.dispose()
}
