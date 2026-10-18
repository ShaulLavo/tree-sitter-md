import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import manifest from './streaming/fixtures.mjs'
import { CORPUS_PROVENANCE, SCHEDULE_SEEDS, loadQualificationCorpus, seededSchedule } from './streaming/corpus.mjs'
import { firstDifference, runStreamingQualification } from './streaming/qualification.mjs'

await init()
const corpus = loadQualificationCorpus()
const report = runStreamingQualification(MarkdownDocument, manifest, { corpus })

test('every original UTF-16 prefix and two-chunk boundary matches fresh complete snapshots', () => {
  assert.equal(report.coverage.originals.length, 33)
  const offsets = manifest.fixtures.reduce((total, fixture) => total + fixture.source.length + 1, 0)
  assert.equal(report.coverage.utf16Prefixes, offsets)
  assert.equal(report.coverage.twoChunkSplits, offsets)
  assert.equal(report.exact.required, offsets * 4 + report.coverage.corpusCheckpoints)
  assert.equal(report.presentation.required, report.exact.required * 2)
  assert.equal(report.exact.failed, 0, JSON.stringify(report.failures))
  assert.equal(report.presentation.failed, 0, JSON.stringify(report.failures))
  assert.equal(report.presentation.missing, 0)
  assert.equal(report.verdict, 'READY')
})

test('exhaustive equality retains the independently authored P0 oracle', () => {
  assert.equal(report.authored.fixtureCount, 33)
  assert.equal(report.authored.checkpointCount, 76)
  assert.equal(report.authored.presentation.required, 364)
  assert.equal(report.authored.exact.failed, 0)
  assert.equal(report.authored.presentation.failed, 0)
  assert.equal(report.authored.presentation.missing, 0)
  assert.equal(report.authored.verdict, 'READY')
})

test('pinned development selection and every seed remain explicit in the denominator', () => {
  assert.equal(CORPUS_PROVENANCE.chat.count, 183)
  assert.equal(CORPUS_PROVENANCE.repository.count, 497)
  assert.equal(corpus.filter(fixture => fixture.kind === 'chat').length, 16)
  assert.equal(corpus.filter(fixture => fixture.kind === 'repository').length, 3)
  assert.equal(SCHEDULE_SEEDS.length, 8)
  assert.equal(new Set(SCHEDULE_SEEDS).size, 8)
  for (const fixture of report.coverage.corpus) verifySelectedFixture(fixture)
})

function verifySelectedFixture(fixture) {
  assert.match(fixture.sha256, /^[a-f0-9]{64}$/u)
  assert.match(fixture.utf16Sha256, /^[a-f0-9]{64}$/u)
  assert.ok(fixture.selectionReason.length > 0)
  assert.equal(fixture.schedules.length, 8)
  assert.equal(new Set(fixture.schedules.map(schedule => JSON.stringify(schedule.cuts))).size, 8, fixture.id + ' must receive eight different schedules')
  for (const schedule of fixture.schedules) {
    assert.equal(schedule.cuts.at(-1), fixture.utf16Length)
    assert.ok(schedule.cuts.length >= 2 && schedule.cuts.length <= (fixture.kind === 'chat' ? 16 : 8))
    assert.ok(schedule.cuts.every((cut, index) => cut > (schedule.cuts[index - 1] ?? 0)))
  }
}

test('fixed-seed schedules reproduce exact UTF-16 cuts without reading parser output', () => {
  const source = '🙂 **alpha**\r\n[ref][id]\n\n[id]: /target\n'
  const schedule = seededSchedule(source, SCHEDULE_SEEDS[0], 8)
  assert.deepEqual(schedule, seededSchedule(source, SCHEDULE_SEEDS[0], 8))
  assert.notDeepEqual(schedule.cuts, seededSchedule(source, SCHEDULE_SEEDS[1], 8).cuts)
  let start = 0
  const chunks = schedule.cuts.map(end => {
    const chunk = source.slice(start, end)
    start = end
    return chunk
  })
  assert.equal(chunks.join(''), source)
})

function controlManifest(id) {
  const fixtures = manifest.fixtures.filter(fixture => fixture.id === id)
  assert.equal(fixtures.length, 1, 'negative-control fixture must exist')
  return { ...manifest, fixtures, requiredBehaviors: fixtures[0].behaviors }
}

function ordinaryNode(snapshot, operation) {
  const node = snapshot.root.children[0]
  if (node) operation(node)
}

function corruptReference(snapshot) {
  const reference = snapshot.references[0]
  if (reference) reference.resolution = reference.resolution === 'resolved' ? 'unresolved' : 'resolved'
}

const controls = [
  ['tree', 'ordinary-without-newline', snapshot => { snapshot.root.children = [] }, '$.root.children.length'],
  ['range', 'ordinary-without-newline', snapshot => ordinaryNode(snapshot, node => { node.range.end = 0 }), '$.root.children.0.range.end'],
  ['reference', 'late-reference', corruptReference, '$.references.0.resolution'],
  ['source', 'nul-source-is-retained', snapshot => { snapshot.source = snapshot.source.replaceAll('\0', '\uFFFD') }, '$'],
  ['mode', 'ordinary-without-newline', snapshot => { snapshot.input = snapshot.input === 'open' ? 'ended' : 'open' }, '$'],
  ['revision', 'ordinary-without-newline', snapshot => { snapshot.revision++ }, '$'],
  ['profile', 'ordinary-without-newline', snapshot => { snapshot.profile = 'invalid-profile' }, '$'],
  ['capabilities', 'ordinary-without-newline', snapshot => { snapshot.capabilities.gfm = !snapshot.capabilities.gfm }, '$.gfm'],
  ['provisional', 'nested-unclosed-emphasis', snapshot => { snapshot.provisional = [] }, '$.provisional.length'],
  ['suppressed', 'bare-heading', snapshot => { snapshot.suppressed = [] }, '$.suppressed.length'],
]

for (const [name, fixtureId, corrupt, differencePath] of controls) {
  test('exhaustive qualification rejects corrupted ' + name + ' through the real parser path', () => {
    const result = runStreamingQualification(MarkdownDocument, controlManifest(fixtureId), {
      observePresentation(document, input) {
        const snapshot = document.presentation({ input })
        corrupt(snapshot)
        return snapshot
      },
    })
    assert.equal(result.verdict, 'NOT READY')
    assert.ok(result.presentation.failed > 0)
    assert.ok(result.failures.some(row => row.failure.difference?.path === differencePath), JSON.stringify(result.failures))
  })
}

test('the complete snapshot comparator rejects a changed resolved destination', () => {
  const result = runStreamingQualification(MarkdownDocument, controlManifest('completed-link-and-image'), {
    observePresentation(document, input) {
      const snapshot = document.presentation({ input })
      const first = snapshot.root.children[0]?.children[0]
      if (first?.type === 'link') first.url = '/stale'
      return snapshot
    },
  })
  assert.equal(result.verdict, 'NOT READY')
  assert.ok(result.presentation.failed > 0)
  assert.ok(result.failures.some(row => row.failure.difference?.path.endsWith('.url')))
})

test('failure witnesses remain bounded while every failed comparison stays counted', () => {
  const result = runStreamingQualification(MarkdownDocument, controlManifest('ordinary-without-newline'), {
    maximumWitnesses: 2,
    observePresentation(document, input) {
      return { ...document.presentation({ input }), source: 'incorrect source' }
    },
  })
  assert.equal(result.failures.length, 2)
  assert.equal(result.presentation.failed, result.presentation.required)
  assert.equal(result.omittedFailureWitnesses, result.presentation.failed - 2)
  assert.ok(result.failures.every(row => row.options && Array.isArray(row.cuts) && typeof row.source === 'string'))
})

test('first-difference witnesses identify structural changes and unexpected fields', () => {
  assert.equal(firstDifference({ root: [{ value: 'same' }] }, { root: [{ value: 'same' }] }), null)
  assert.equal(firstDifference({ root: [] }, { root: [1] }).path, '$.root.length')
  assert.equal(firstDifference({ root: [], stale: true }, { root: [] }).path, '$.stale')
})
