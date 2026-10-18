import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import { lifetimeBounds, runPresentationLifetimes } from './streaming/lifetime.mjs'

await init()

test('caller input modes, retained snapshots and independent documents survive edits and disposal', () => {
  const result = runPresentationLifetimes({ MarkdownDocument, equal: assert.deepEqual, assert: assert.ok })
  assert.equal(result.fixtures, 15)
  assert.equal(result.deliveryReads, 135)
  assert.equal(result.terminalResumeEdits, 45)
  assert.equal(result.rawReplacementCases, 15)
  assert.deepEqual(result.containerDepths, lifetimeBounds.containerDepths)
  assert.equal(result.simultaneousDocuments, 64)
  assert.equal(result.rawSourceEdits, 8)
})

for (const marker of ['> ', '- ', '> - ']) {
  test('deep container extraction keeps leaf scratch bounded for ' + JSON.stringify(marker), () => {
    const document = new MarkdownDocument({ gfm: true, math: true })
    const sibling = new MarkdownDocument({ gfm: false })
    try {
      sibling.setText('sibling **pending')
      const before = sibling.presentation({ input: 'open' })
      for (const depth of [180, 199, 200, 201, 256]) verifyContainers(document, marker, depth)
      document.dispose()
      assert.deepEqual(sibling.presentation({ input: 'open' }), before)
    } finally {
      document.dispose()
      sibling.dispose()
    }
  })
}

function verifyContainers(document, marker, depth) {
  const source = marker.repeat(depth) + '**pending'
  document.setText(source)
  const exact = document.semantics()
  const open = document.presentation({ input: 'open' })
  const saved = structuredClone(open)
  assert.equal(open.source, source)
  assert.equal(open.revision, exact.revision)
  assert.deepEqual(document.presentation({ input: 'ended' }).root, exact.root)
  document.setText('replacement')
  assert.deepEqual(open, saved)
}
