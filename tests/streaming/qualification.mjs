import assert from 'node:assert/strict'
import { compareObservation, runFixtureMatrix, validateFixtureManifest, validateObservation } from './driver.mjs'
import { CORPUS_PROVENANCE, SCHEDULE_SEEDS, seededSchedule, sha256, sourceIdentity } from './corpus.mjs'

const INPUTS = ['open', 'ended']
const MAXIMUM_WITNESSES = 20

function preview(value) {
  if (typeof value === 'string') return value.length <= 240 ? value : value.slice(0, 120) + '…' + value.slice(-120)
  if (value === undefined) return '<absent>'
  if (Array.isArray(value)) return { type: 'array', length: value.length }
  if (value !== null && typeof value === 'object') return { type: 'object', keys: Object.keys(value) }
  return value
}

export function firstDifference(actual, expected, path = '$') {
  if (Object.is(actual, expected)) return null
  if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') {
    return { path, actual: preview(actual), expected: preview(expected) }
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) return { path, actual: preview(actual), expected: preview(expected) }
  if (Array.isArray(actual) && actual.length !== expected.length) return { path: path + '.length', actual: actual.length, expected: expected.length }
  const keys = Object.keys(expected)
  for (const key of keys) {
    if (!Object.hasOwn(actual, key)) return { path: path + '.' + key, actual: '<absent>', expected: preview(expected[key]) }
    const difference = firstDifference(actual[key], expected[key], path + '.' + key)
    if (difference) return difference
  }
  const extra = Object.keys(actual).find(key => !Object.hasOwn(expected, key))
  return extra === undefined ? null : { path: path + '.' + extra, actual: preview(actual[extra]), expected: '<absent>' }
}

function equal(actual, expected, label) {
  const difference = firstDifference(actual, expected)
  if (!difference) return
  const error = new assert.AssertionError({ message: label + ' at ' + difference.path, actual: difference.actual, expected: difference.expected })
  error.difference = difference
  throw error
}

function snapshotValue(snapshot) {
  const { revision, ...value } = snapshot
  return value
}

export function compareSnapshots(actual, expected, { source, input, exact }) {
  equal(actual.source, source, 'presentation source differs from supplied UTF-16 source')
  equal(actual.input, input, 'presentation input mode differs from request')
  equal(actual.revision, exact.revision, 'presentation revision differs within its document')
  equal(actual.profile, exact.profile, 'presentation profile differs from exact semantics')
  equal(actual.capabilities, exact.capabilities, 'presentation capabilities differ from exact semantics')
  equal(snapshotValue(actual), snapshotValue(expected), 'edited presentation differs from fresh loading')
  validateObservation(actual, source, input)
  if (input === 'ended') equal(actual.root, exact.root, 'ended root differs from independent exact semantics path')
}

function counter() {
  return { required: 0, passed: 0, failed: 0, missing: 0 }
}

function sourceWitness(source) {
  return source.length <= 256 ? { source } : { sourcePreview: preview(source), ...sourceIdentity(source) }
}

function identity(fixture, schedule, at) {
  return { fixture: fixture.id, kind: fixture.kind ?? 'original', options: fixture.options, schedule: schedule.id, cuts: schedule.cuts, at }
}

function retainFailure(context, details, error, source) {
  if (context.failures.length >= context.maximumWitnesses) return
  const failure = { name: error.name, message: error.message.slice(0, 800) }
  if (error.difference) failure.difference = error.difference
  context.failures.push({ ...details, ...sourceWitness(source), failure })
}

function record(context, group, details, source, operation) {
  const counts = context.groups[group]
  counts.required++
  try {
    operation()
    counts.passed++
  } catch (error) {
    counts.failed++
    retainFailure(context, { ...details, check: group }, error, source)
  }
}

function missing(context, details, source) {
  context.groups.presentation.required++
  context.groups.presentation.missing++
  retainFailure(context, { ...details, check: 'presentation', status: 'missing-capability' }, new TypeError('MarkdownDocument.presentation is required'), source)
}

function assertRevision(document, revision) {
  equal(document.semantics().revision, revision, 'queries must preserve document-scoped source revision')
}

function readPresentation(document, source, input, observe) {
  const exact = document.semantics()
  const snapshot = observe(document, input)
  equal(snapshot.source, source, 'presentation source differs from supplied UTF-16 source')
  equal(snapshot.input, input, 'presentation input mode differs from request')
  equal(snapshot.revision, exact.revision, 'presentation revision differs within its document')
  equal(snapshot.profile, exact.profile, 'presentation profile differs from exact semantics')
  equal(snapshot.capabilities, exact.capabilities, 'presentation capabilities differ from exact semantics')
  assertRevision(document, exact.revision)
  return { exact, snapshot }
}

function authoredAt(document, fixture, source, input, snapshot) {
  for (const check of fixture.checkpoints ?? []) {
    if (check.at !== source.length || check.input !== input) continue
    compareObservation(snapshot, check.expected, { source, input })
    if (input === 'ended') equal(document.semantics().root, check.expected.root, 'exact root differs from authored endpoint')
  }
}

function compareInput(context, document, fresh, fixture, source, details, input) {
  if (!context.observe) return missing(context, { ...details, input }, source)
  record(context, 'presentation', { ...details, input }, source, () => {
    const expected = readPresentation(fresh, source, input, context.nativeObserve)
    const actual = readPresentation(document, source, input, context.observe)
    compareSnapshots(actual.snapshot, expected.snapshot, { source, input, exact: actual.exact })
    if (input === 'ended') equal(expected.snapshot.root, expected.exact.root, 'fresh ended root differs from independent exact semantics path')
    authoredAt(document, fixture, source, input, actual.snapshot)
  })
}

function compareSource(context, MarkdownDocument, document, fixture, source, details, setupError) {
  let fresh
  let failure = setupError
  try {
    fresh = new MarkdownDocument(fixture.options)
    fresh.setText(source)
  } catch (error) {
    failure ??= error
  }
  if (failure) {
    const throwFailure = () => { throw failure }
    record(context, 'exact', details, source, throwFailure)
    for (const input of INPUTS) record(context, 'presentation', { ...details, input }, source, throwFailure)
    fresh?.dispose()
    return
  }
  try {
    record(context, 'exact', details, source, () => {
      const actual = document.semantics()
      const expected = fresh.semantics()
      equal(snapshotValue(actual), snapshotValue(expected), 'edited exact semantics differs from fresh loading')
      assertRevision(document, actual.revision)
    })
    for (const input of INPUTS) compareInput(context, document, fresh, fixture, source, details, input)
  } finally {
    fresh.dispose()
  }
}

function initialize(MarkdownDocument, fixture) {
  let document
  try {
    document = new MarkdownDocument(fixture.options)
    document.setText('')
    return { document, error: null }
  } catch (error) {
    return { document, error }
  }
}

function append(document, source, start, setupError) {
  if (setupError) return setupError
  try {
    document.edit(start, start, source.slice(start))
    return null
  } catch (error) {
    return error
  }
}

function runSchedule(context, MarkdownDocument, fixture, schedule) {
  const state = initialize(MarkdownDocument, fixture)
  let start = 0
  try {
    compareSource(context, MarkdownDocument, state.document, fixture, '', identity(fixture, schedule, 0), state.error)
    for (const end of schedule.cuts) {
      const source = fixture.source.slice(0, end)
      state.error = append(state.document, source, start, state.error)
      compareSource(context, MarkdownDocument, state.document, fixture, source, identity(fixture, schedule, end), state.error)
      start = end
    }
  } finally {
    state.document?.dispose()
  }
}

function originalSchedules(fixture) {
  const prefix = { id: 'every-utf16-prefix', cuts: Array.from({ length: fixture.source.length }, (_, index) => index + 1) }
  const splits = Array.from({ length: fixture.source.length + 1 }, (_, cut) => ({ id: 'two-chunk-' + cut, cuts: [cut, fixture.source.length] }))
  return [prefix].concat(splits)
}

function corpusSchedules(fixture) {
  return SCHEDULE_SEEDS.map(seed => seededSchedule(fixture.source, seed, fixture.kind === 'chat' ? 16 : 8))
}

function coverage(fixtures, corpus) {
  const originals = fixtures.map(fixture => ({ id: fixture.id, options: fixture.options, ...sourceIdentity(fixture.source) }))
  const selected = corpus.map(fixture => {
    const { source, ...metadata } = fixture
    return { ...metadata, schedules: corpusSchedules(fixture) }
  })
  const prefixes = fixtures.reduce((total, fixture) => total + fixture.source.length + 1, 0)
  const twoChunkSplits = prefixes
  const corpusCheckpoints = selected.reduce((total, fixture) => total + fixture.schedules.reduce((sum, schedule) => sum + schedule.cuts.length + 1, 0), 0)
  const sourceCheckpoints = prefixes + twoChunkSplits * 3 + corpusCheckpoints
  return { originals, corpus: selected, utf16Prefixes: prefixes, twoChunkSplits, corpusCheckpoints, sourceCheckpoints, presentationComparisons: sourceCheckpoints * 2 }
}

function compactAuthored(report, maximumWitnesses) {
  const summary = rows => ({ required: rows.required, passed: rows.passed, failed: rows.failed, missing: rows.missing })
  const failures = report.exact.checks.concat(report.candidate.checks).filter(check => check.status !== 'passed').slice(0, maximumWitnesses).map(check => {
    if (!check.failure) return check
    return { ...check, failure: { ...check.failure, message: check.failure.message.slice(0, 800) } }
  })
  return { verdict: report.verdict, fixtureCount: report.fixtureCount, checkpointCount: report.checkpointCount, fixtureHash: report.fixtureHash, exact: summary(report.exact), presentation: summary(report.candidate), failures }
}

export function runStreamingQualification(MarkdownDocument, manifest, { corpus = [], observePresentation, maximumWitnesses = MAXIMUM_WITNESSES } = {}) {
  validateFixtureManifest(manifest)
  assert.ok(Number.isSafeInteger(maximumWitnesses) && maximumWitnesses >= 0 && maximumWitnesses <= 100, 'witness limit must be 0..100')
  const nativeObserve = (document, input) => document.presentation({ input })
  const observe = observePresentation ?? (typeof MarkdownDocument.prototype.presentation === 'function' ? nativeObserve : null)
  const context = { groups: { exact: counter(), presentation: counter() }, failures: [], observe, nativeObserve, maximumWitnesses }
  const authored = compactAuthored(runFixtureMatrix(MarkdownDocument, manifest, { observePresentation: observe }), maximumWitnesses)
  const selected = coverage(manifest.fixtures, corpus)
  for (const fixture of manifest.fixtures) {
    for (const schedule of originalSchedules(fixture)) runSchedule(context, MarkdownDocument, fixture, schedule)
  }
  for (const fixture of corpus) {
    for (const schedule of corpusSchedules(fixture)) runSchedule(context, MarkdownDocument, fixture, schedule)
  }
  assert.equal(context.groups.exact.required, selected.sourceCheckpoints, 'every selected source checkpoint must enter the exact denominator')
  assert.equal(context.groups.presentation.required, selected.presentationComparisons, 'every selected input mode must enter the presentation denominator')
  const failed = context.groups.exact.failed + context.groups.presentation.failed
  const missing = context.groups.presentation.missing
  return {
    schemaVersion: 1,
    scope: 'P4 exhaustive original UTF-16 prefixes and two-chunk boundaries; pinned development corpus multichunk schedules',
    verdict: authored.verdict === 'READY' && failed === 0 && missing === 0 ? 'READY' : 'NOT READY',
    fixtureHash: sha256(JSON.stringify(manifest)),
    corpusProvenance: CORPUS_PROVENANCE,
    seeds: SCHEDULE_SEEDS,
    coverage: selected,
    authored,
    ...context.groups,
    failures: context.failures,
    omittedFailureWitnesses: Math.max(0, failed + missing - context.failures.length),
    toolchain: { node: process.version, platform: process.platform, architecture: process.arch },
  }
}
