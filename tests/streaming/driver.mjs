import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const FIXTURE_FILE = new URL('./fixtures.json', import.meta.url)
const SCHEDULES = new Set(['whole', 'codepoint', 'utf16', 'two-chunk'])
const POLICIES = new Set(['immediate', 'provisional', 'hold', 'literal', 'reclassify', 'pending-reference'])
const NODE_KINDS = new Set([
  'paragraph', 'text', 'strong', 'emphasis', 'code', 'pendingLink', 'pendingImage',
  'pendingMath', 'link', 'image', 'definition', 'footnoteDefinition', 'heading',
  'quote', 'list', 'listItem', 'table', 'thematicBreak', 'break',
])

export function readFixtureManifest() {
  return JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'))
}

function assertBoolean(value, label) {
  assert.equal(typeof value, 'boolean', `${label} must be a boolean`)
}

function assertString(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`)
}

function assertSourceSpan(span, sourceLength, label) {
  assert.equal(typeof span, 'object', `${label} must be an object`)
  assert.equal(Number.isSafeInteger(span.start), true, `${label}.start must be an integer`)
  assert.ok(span.start >= 0 && span.start <= sourceLength, `${label}.start is outside source`)
  if (span.end === 'sourceEnd') return
  assert.equal(Number.isSafeInteger(span.end), true, `${label}.end must be an integer or sourceEnd`)
  assert.ok(span.end >= span.start && span.end <= sourceLength, `${label}.end is outside source`)
}

function assertExpectation(expectation, sourceLength, label) {
  assert.equal(typeof expectation, 'object', `${label} must be an object`)
  assert.ok(POLICIES.has(expectation.policy), `${label}.policy is unknown`)
  assertString(expectation.displayText, `${label}.displayText`)
  assert.equal(Array.isArray(expectation.nodeKinds), true, `${label}.nodeKinds must be an array`)
  for (const [index, kind] of expectation.nodeKinds.entries()) {
    assert.ok(NODE_KINDS.has(kind), `${label}.nodeKinds[${index}] is unknown`)
  }
  assert.equal(Array.isArray(expectation.forbiddenFields), true, `${label}.forbiddenFields must be an array`)
  for (const field of expectation.forbiddenFields) assertString(field, `${label}.forbiddenFields item`)
  assert.equal(Array.isArray(expectation.reasons), true, `${label}.reasons must be an array`)
  for (const reason of expectation.reasons) assertString(reason, `${label}.reasons item`)
  if (expectation.sourceSpans) {
    assert.equal(Array.isArray(expectation.sourceSpans), true, `${label}.sourceSpans must be an array`)
    for (const [index, span] of expectation.sourceSpans.entries()) assertSourceSpan(span, sourceLength, `${label}.sourceSpans[${index}]`)
  }
}

function assertOptions(options, label) {
  assert.equal(typeof options, 'object', `${label} must be an object`)
  assertBoolean(options.gfm, `${label}.gfm`)
  assertBoolean(options.cjk, `${label}.cjk`)
  assertBoolean(options.math, `${label}.math`)
}

export function validateFixtureManifest(manifest) {
  assert.equal(manifest.schemaVersion, 1, 'schemaVersion must be 1')
  assert.equal(manifest.profile, 'fregat-chat', 'profile must be fregat-chat')
  assert.deepEqual(manifest.schedules, ['whole', 'codepoint', 'utf16', 'two-chunk'])
  assert.equal(Array.isArray(manifest.fixtures), true)
  const ids = new Set()
  for (const [index, fixture] of manifest.fixtures.entries()) {
    const label = `fixtures[${index}]`
    assertString(fixture.id, `${label}.id`)
    assert.equal(ids.has(fixture.id), false, `duplicate fixture id ${fixture.id}`)
    ids.add(fixture.id)
    assertString(fixture.source, `${label}.source`)
    assertOptions(fixture.options, `${label}.options`)
    assert.equal(Array.isArray(fixture.tags), true, `${label}.tags must be an array`)
    assert.ok(fixture.tags.length > 0, `${label}.tags must not be empty`)
    for (const tag of fixture.tags) assertString(tag, `${label}.tags item`)
    assert.equal(Array.isArray(fixture.schedules), true, `${label}.schedules must be an array`)
    for (const schedule of fixture.schedules) assert.ok(SCHEDULES.has(schedule), `${label}.schedules has unknown ${schedule}`)
    assertExpectation(fixture.open, fixture.source.length, `${label}.open`)
    assert.equal(fixture.ended?.policy, 'exact', `${label}.ended.policy must be exact`)
    assert.equal(fixture.ended?.source, 'received', `${label}.ended.source must be received`)
    if (fixture.sourceSpans) {
      assert.equal(Array.isArray(fixture.sourceSpans), true, `${label}.sourceSpans must be an array`)
      for (const [spanIndex, span] of fixture.sourceSpans.entries()) assertSourceSpan(span, fixture.source.length, `${label}.sourceSpans[${spanIndex}]`)
    }
    const checkpoints = fixture.checkpoints ?? []
    assert.equal(Array.isArray(checkpoints), true, `${label}.checkpoints must be an array`)
    let previousLength = -1
    for (const [checkpointIndex, checkpoint] of checkpoints.entries()) {
      const checkpointLabel = `${label}.checkpoints[${checkpointIndex}]`
      assertString(checkpoint.source, `${checkpointLabel}.source`)
      assert.ok(fixture.source.startsWith(checkpoint.source), `${checkpointLabel}.source must be a prefix`)
      assert.ok(checkpoint.source.length > previousLength, `${checkpointLabel}.source must advance`)
      previousLength = checkpoint.source.length
      assertExpectation(checkpoint.open, checkpoint.source.length, `${checkpointLabel}.open`)
    }
  }
  return manifest.fixtures.length
}

export function chunksFor(source, schedule) {
  if (schedule === 'whole') return [source]
  if (schedule === 'codepoint') return Array.from(source)
  if (schedule === 'utf16') return Array.from({ length: source.length }, (_, index) => source[index])
  if (schedule === 'two-chunk') {
    const midpoint = Math.floor(source.length / 2)
    return source.length < 2 ? [source] : [source.slice(0, midpoint), source.slice(midpoint)]
  }
  throw new TypeError(`unknown streaming schedule: ${schedule}`)
}

function snapshotFresh(MarkdownDocument, source, options) {
  const document = new MarkdownDocument(options)
  try {
    document.setText(source)
    return document.semantics()
  } finally {
    document.dispose()
  }
}

function snapshotIncremental(MarkdownDocument, chunks, options) {
  const document = new MarkdownDocument(options)
  const snapshots = []
  let source = ''
  try {
    document.setText('')
    for (const chunk of chunks) {
      document.edit(source.length, source.length, chunk)
      source += chunk
      snapshots.push({ source, snapshot: document.semantics() })
    }
    return snapshots
  } finally {
    document.dispose()
  }
}

export function runExactFixture(MarkdownDocument, fixture, schedule) {
  const chunks = chunksFor(fixture.source, schedule)
  const incremental = snapshotIncremental(MarkdownDocument, chunks, fixture.options)
  for (const { source, snapshot } of incremental) {
    const fresh = snapshotFresh(MarkdownDocument, source, fixture.options)
    assert.deepEqual(snapshot.root, fresh.root, `${fixture.id}/${schedule}: incremental result differs at ${source.length}`)
  }
  const final = incremental.at(-1)?.snapshot
  const expected = snapshotFresh(MarkdownDocument, fixture.source, fixture.options)
  assert.ok(final, `${fixture.id}/${schedule}: no snapshot was produced`)
  assert.deepEqual(final.root, expected.root, `${fixture.id}/${schedule}: final result differs from fresh parse`)
  return { chunks: chunks.length, prefixes: incremental.length }
}

function candidateStatus(MarkdownDocument) {
  if (typeof MarkdownDocument.prototype.presentation !== 'function') {
    return { status: 'missing-capability', missing: ['MarkdownDocument.presentation'] }
  }
  return { status: 'unverified', missing: ['presentation expectation evaluator'] }
}

export function runFixtureMatrix(MarkdownDocument, manifest = readFixtureManifest()) {
  validateFixtureManifest(manifest)
  const exact = []
  for (const fixture of manifest.fixtures) {
    for (const schedule of fixture.schedules) exact.push({ fixture: fixture.id, schedule, ...runExactFixture(MarkdownDocument, fixture, schedule) })
  }
  return { schemaVersion: manifest.schemaVersion, profile: manifest.profile, fixtureCount: manifest.fixtures.length, exact, candidate: candidateStatus(MarkdownDocument) }
}
