import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import {
  chunksFor,
  readFixtureManifest,
  runExactFixture,
  runFixtureMatrix,
  validateFixtureManifest,
} from './streaming/driver.mjs'

const manifest = readFixtureManifest()
validateFixtureManifest(manifest)
await init()

test('streaming fixture matrix has independent expectations for every required family', () => {
  const ids = new Set(manifest.fixtures.map(fixture => fixture.id))
  for (const id of ['nested-emphasis', 'pending-link', 'open-fence', 'table-candidate', 'late-reference', 'footnote-reference', 'pending-math', 'nested-container-tail']) {
    assert.ok(ids.has(id), `missing required fixture ${id}`)
  }
  assert.ok(manifest.fixtures.every(fixture => fixture.sourceSpans?.length > 0))
  assert.ok(manifest.fixtures.some(fixture => fixture.checkpoints?.length > 0))
})

test('streaming schedules preserve UTF-16 units and source boundaries', () => {
  const source = '🙂 **שלום**'
  assert.deepEqual(chunksFor(source, 'codepoint').join(''), source)
  assert.deepEqual(chunksFor(source, 'utf16').join(''), source)
  assert.equal(chunksFor(source, 'utf16').length, source.length)
  assert.equal(chunksFor(source, 'codepoint').length, Array.from(source).length)
})

test('exact semantics remain fresh-equivalent across the two-chunk schedule', () => {
  const fixture = manifest.fixtures.find(value => value.id === 'late-reference')
  assert.ok(fixture)
  const result = runExactFixture(MarkdownDocument, fixture, 'two-chunk')
  assert.equal(result.chunks, 2)
  assert.equal(result.prefixes, 2)
})

test('negative control proves the driver detects stale source', () => {
  const fresh = new MarkdownDocument()
  const stale = new MarkdownDocument()
  try {
    fresh.setText('[ref]\n\n[ref]: /target')
    stale.setText('[ref]')
    assert.notDeepEqual(fresh.semantics().root, stale.semantics().root)
  } finally {
    fresh.dispose()
    stale.dispose()
  }
})

test('candidate capability is explicit before native presentation exists', () => {
  const report = runFixtureMatrix(MarkdownDocument, { ...manifest, fixtures: manifest.fixtures.slice(0, 1) })
  assert.equal(report.candidate.status, 'missing-capability')
  assert.deepEqual(report.candidate.missing, ['MarkdownDocument.presentation'])
})

test('fixture validation rejects missing independent expectations', () => {
  const invalid = structuredClone(manifest)
  delete invalid.fixtures[0].open.reasons
  assert.throws(() => validateFixtureManifest(invalid), /reasons must be an array/)
})

test('fixture validation rejects a checkpoint outside the received source', () => {
  const invalid = structuredClone(manifest)
  invalid.fixtures.find(fixture => fixture.id === 'late-reference').checkpoints[0].source = 'not a prefix'
  assert.throws(() => validateFixtureManifest(invalid), /must be a prefix/)
})
