import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const SCHEDULES = ['whole', 'codepoint', 'utf16', 'midpoint']
const CHILDREN = ['children', 'items', 'rows', 'cells']
const CONTAINERS = new Set(['root', 'paragraph', 'heading', 'quote', 'strong', 'emphasis', 'delete', 'link', 'pendingLink', 'listItem', 'footnoteDefinition', 'tableCell'])
const VALUES = new Set(['text', 'code', 'html', 'math', 'pendingMath'])
const LEAVES = new Set(['break', 'image', 'pendingImage', 'definition', 'footnoteReference', 'thematicBreak'])

function object(value, label) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), label + ' must be an object')
}

function string(value, label) {
  assert.equal(typeof value, 'string', label + ' must be a string')
}

function range(value, length) {
  object(value, 'range')
  assert.ok(Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end), 'range requires UTF-16 integer offsets')
  assert.ok(value.start >= 0 && value.end >= value.start && value.end <= length, 'range is outside received source')
}

function list(value, label) {
  assert.ok(Array.isArray(value), label + ' must be an array')
}

function destination(node) {
  string(node.url, 'url')
  assert.ok(node.title === null || typeof node.title === 'string', 'title must be a string or null')
}

function attributes(node) {
  if (VALUES.has(node.type)) string(node.value, 'node.value')
  if (['link', 'image', 'definition'].includes(node.type)) destination(node)
  if (['image', 'pendingImage'].includes(node.type)) string(node.alt, 'image.alt')
  if (['definition', 'footnoteDefinition', 'footnoteReference'].includes(node.type)) string(node.identifier, 'identifier')
  if (['pendingLink', 'pendingImage'].includes(node.type)) assert.equal('url' in node, false, 'pending destinations must be absent')
  if (node.type === 'break') assert.equal(typeof node.hard, 'boolean', 'break.hard must be boolean')
  if (node.type === 'heading') assert.ok(Number.isInteger(node.depth) && node.depth >= 1 && node.depth <= 6, 'heading depth must be 1..6')
  if (node.type === 'listItem') {
    assert.equal(typeof node.spread, 'boolean')
    assert.ok(node.checked === null || typeof node.checked === 'boolean', 'task state must be boolean or null')
  }
  if (node.type === 'code' && 'fence' in node) {
    assert.ok(['open', 'closed', 'indented'].includes(node.fence), 'unknown code fence state')
    assert.ok(node.language === null || typeof node.language === 'string', 'code language must be string or null')
    assert.ok(node.meta === null || typeof node.meta === 'string', 'code metadata must be string or null')
  }
}

function descendants(node, length) {
  for (const field of CHILDREN) {
    if (!(field in node)) continue
    list(node[field], field)
    for (const child of node[field]) validateNode(child, length)
  }
}

function validateNode(node, length) {
  object(node, 'semantic node')
  string(node.type, 'node.type')
  assert.ok(CONTAINERS.has(node.type) || VALUES.has(node.type) || LEAVES.has(node.type) || ['list', 'table', 'tableRow'].includes(node.type), 'unknown semantic node ' + node.type)
  if (node.type === 'tableCell' && node.range === null) assert.deepEqual(node.children, [], 'only padded empty cells have null ranges')
  else range(node.range, length)
  attributes(node)
  if (CONTAINERS.has(node.type)) list(node.children, 'children')
  if (node.type === 'list') {
    list(node.items, 'items')
    assert.equal(typeof node.ordered, 'boolean')
    assert.equal(typeof node.spread, 'boolean')
    assert.ok(node.ordered ? Number.isSafeInteger(node.start) && node.start >= 0 : node.start === null, 'invalid list start')
  }
  if (node.type === 'table') {
    list(node.rows, 'rows')
    list(node.align, 'align')
    assert.ok(node.align.every(value => [null, 'left', 'center', 'right'].includes(value)), 'unknown table alignment')
    assert.ok(node.rows.every(row => row.cells?.length === node.align.length), 'table columns must preserve every alignment')
  }
  if (node.type === 'tableRow') list(node.cells, 'cells')
  descendants(node, length)
}

function atPath(root, path) {
  list(path, 'provisional path')
  let value = root
  for (const part of path) {
    assert.ok(typeof part === 'string' || Number.isSafeInteger(part), 'path parts must be keys or indexes')
    value = value?.[part]
  }
  object(value, 'provisional node')
  string(value.type, 'provisional node type')
  return value
}

export function validateObservation(value, source, input) {
  object(value, 'observation')
  validateNode(value.root, source.length)
  assert.equal(value.root.type, 'root')
  assert.deepEqual(value.root.range, { start: 0, end: source.length }, 'root must cover received source')
  for (const field of ['provisional', 'suppressed', 'references']) list(value[field], field)
  for (const record of value.provisional) {
    atPath(value.root, record.path)
    string(record.reason, 'provisional reason')
    assert.ok(record.reason.length > 0, 'provisional reason must not be empty')
  }
  for (const record of value.suppressed) {
    range(record.range, source.length)
    string(record.reason, 'suppression reason')
  }
  for (const record of value.references) {
    range(record.range, source.length)
    assert.ok(['link', 'footnote'].includes(record.kind), 'unknown reference kind')
    string(record.identifier, 'reference identifier')
    assert.ok(['resolved', 'unresolved'].includes(record.resolution), 'unknown reference resolution')
  }
  if (input === 'ended') {
    assert.deepEqual(value.provisional, [], 'ended interpretation cannot remain provisional')
    assert.deepEqual(value.suppressed, [], 'ended interpretation cannot suppress received syntax')
  }
}

export function compareObservation(actual, expected, { source, input }) {
  object(actual, 'candidate observation')
  assert.equal(actual.source, source, 'candidate must preserve exact received source')
  assert.equal(actual.input, input, 'candidate must honor requested input state')
  assert.ok(Number.isSafeInteger(actual.revision) && actual.revision >= 0, 'candidate must identify its source revision')
  validateObservation(actual, source, input)
  for (const field of ['root', 'provisional', 'suppressed', 'references']) {
    assert.deepEqual(actual[field], expected[field], 'presentation ' + field + ' differs from independently authored expectation')
  }
}

function checkpoint(check, fixture) {
  string(check.id, 'checkpoint id')
  assert.ok(Number.isSafeInteger(check.at) && check.at >= 0 && check.at <= fixture.source.length, 'checkpoint offset is outside received source')
  assert.ok(['open', 'ended'].includes(check.input), 'unknown checkpoint input state')
  validateObservation(check.expected, fixture.source.slice(0, check.at), check.input)
}

function validateFixture(fixture) {
  string(fixture.id, 'fixture id')
  string(fixture.source, 'fixture source')
  assert.equal(fixture.attribution, 'original')
  list(fixture.behaviors, 'fixture behaviors')
  object(fixture.options, 'parser options')
  for (const key of ['gfm', 'cjk', 'math']) assert.equal(typeof fixture.options[key], 'boolean', 'option ' + key + ' must be boolean')
  assert.deepEqual(fixture.schedules, SCHEDULES, 'every fixture must use the P0 schedules')
  list(fixture.checkpoints, 'checkpoints')
  assert.equal(new Set(fixture.checkpoints.map(check => check.id)).size, fixture.checkpoints.length, 'checkpoint IDs must be unique within a fixture')
  for (const check of fixture.checkpoints) checkpoint(check, fixture)
  for (const input of ['open', 'ended']) {
    assert.ok(fixture.checkpoints.some(check => check.at === fixture.source.length && check.input === input), 'fixture requires final ' + input + ' checkpoint')
  }
  if (fixture.replay) validateCuts(fixture.source, fixture.replay.cuts)
}

export function validateFixtureManifest(manifest) {
  assert.equal(manifest.schemaVersion, 2, 'schemaVersion must be 2')
  list(manifest.fixtures, 'fixtures')
  assert.ok(manifest.fixtures.length > 0, 'empty corpus cannot establish readiness')
  assert.equal(new Set(manifest.fixtures.map(fixture => fixture.id)).size, manifest.fixtures.length, 'fixture IDs must be unique')
  object(manifest.baseline, 'baseline')
  for (const key of ['parserCommit', 'runtimeCommit']) assert.match(manifest.baseline[key], /^[a-f0-9]{40}$/u, key + ' must pin a full commit')
  string(manifest.baseline.packageVersion, 'baseline package version')
  list(manifest.references, 'reference provenance')
  assert.ok(manifest.references.length > 0, 'fixture provenance must be recorded')
  for (const reference of manifest.references) {
    for (const key of ['id', 'url', 'revision', 'license', 'evidence']) string(reference[key], 'reference ' + key)
    assert.match(reference.revision, /^[a-f0-9]{40}$/u)
  }
  for (const fixture of manifest.fixtures) validateFixture(fixture)
  list(manifest.requiredBehaviors, 'required behaviors')
  const covered = new Set(manifest.fixtures.flatMap(fixture => fixture.behaviors))
  assert.ok(manifest.requiredBehaviors.length > 0)
  for (const behavior of manifest.requiredBehaviors) assert.ok(covered.has(behavior), 'missing required behavior ' + behavior)
  return manifest.fixtures.length
}

function validateCuts(source, cuts) {
  list(cuts, 'replay cuts')
  let previous = 0
  for (const cut of cuts) {
    assert.ok(Number.isSafeInteger(cut) && cut > previous && cut <= source.length, 'replay cuts must advance inside source')
    previous = cut
  }
  assert.equal(previous, source.length, 'replay must consume the complete source')
}

export function chunksFor(source, schedule) {
  if (schedule === 'whole') return [source]
  if (schedule === 'codepoint') return Array.from(source)
  if (schedule === 'utf16') return Array.from({ length: source.length }, (_, index) => source[index])
  if (schedule === 'midpoint') {
    const midpoint = Math.floor(source.length / 2)
    return source.length < 2 ? [source] : [source.slice(0, midpoint), source.slice(midpoint)]
  }
  validateCuts(source, schedule.cuts)
  let start = 0
  return schedule.cuts.map(end => {
    const value = source.slice(start, end)
    start = end
    return value
  })
}

function fresh(MarkdownDocument, fixture, source, operation) {
  const document = new MarkdownDocument(fixture.options)
  try {
    document.setText(source)
    return operation(document)
  } finally {
    document.dispose()
  }
}

function record(rows, identity, operation) {
  try {
    operation()
    rows.push({ ...identity, status: 'passed' })
  } catch (error) {
    rows.push({ ...identity, status: 'failed', failure: { name: error.name, message: error.message } })
  }
}

function evaluateCheckpoint(document, fixture, check, schedule, context) {
  const source = fixture.source.slice(0, check.at)
  const identity = { fixture: fixture.id, checkpoint: check.id, schedule, at: check.at, input: check.input }
  if (check.input === 'ended') {
    record(context.exact, { ...identity, kind: 'authored' }, () => {
      assert.deepEqual(document.semantics().root, check.expected.root, 'exact result differs from independently authored ended root')
    })
  }
  if (!context.observe) {
    context.candidate.push({ ...identity, status: 'missing-capability', missing: 'MarkdownDocument.presentation' })
    return
  }
  record(context.candidate, identity, () => {
    const actual = context.observe(document, check.input)
    compareObservation(actual, check.expected, { source, input: check.input })
    const exact = document.semantics()
    assert.equal(actual.revision, exact.revision, 'presentation must identify the current source revision')
    assert.equal(actual.profile, exact.profile, 'presentation must identify the configured profile')
    assert.deepEqual(actual.capabilities, exact.capabilities, 'presentation must identify enabled capabilities')
  })
}

function runSchedule(MarkdownDocument, fixture, schedule, context) {
  const document = new MarkdownDocument(fixture.options)
  const id = typeof schedule === 'string' ? schedule : schedule.id
  let source = ''
  try {
    document.setText(source)
    for (const chunk of chunksFor(fixture.source, schedule)) {
      document.edit(source.length, source.length, chunk)
      source += chunk
      comparePrefix(MarkdownDocument, document, fixture, source, id, context)
    }
  } finally {
    document.dispose()
  }
}

function comparePrefix(MarkdownDocument, document, fixture, source, schedule, context) {
  record(context.exact, { fixture: fixture.id, schedule, at: source.length, kind: 'incremental' }, () => {
    const root = fresh(MarkdownDocument, fixture, source, value => value.semantics().root)
    assert.deepEqual(document.semantics().root, root, 'incremental exact root differs from fresh parse')
  })
  for (const check of fixture.checkpoints) {
    if (check.at === source.length) evaluateCheckpoint(document, fixture, check, schedule, context)
  }
}

function counts(rows) {
  return {
    required: rows.length,
    passed: rows.filter(row => row.status === 'passed').length,
    failed: rows.filter(row => row.status === 'failed').length,
    missing: rows.filter(row => row.status === 'missing-capability').length,
  }
}

export function runFixtureMatrix(MarkdownDocument, manifest, { observePresentation } = {}) {
  validateFixtureManifest(manifest)
  const observe = observePresentation ?? (typeof MarkdownDocument.prototype.presentation === 'function'
    ? (document, input) => document.presentation({ input }) : null)
  const context = { exact: [], candidate: [], observe }
  for (const fixture of manifest.fixtures) {
    for (const check of fixture.checkpoints) {
      fresh(MarkdownDocument, fixture, fixture.source.slice(0, check.at), document => evaluateCheckpoint(document, fixture, check, 'checkpoint', context))
    }
    for (const schedule of fixture.schedules) runSchedule(MarkdownDocument, fixture, schedule, context)
    if (fixture.replay) runSchedule(MarkdownDocument, fixture, fixture.replay, context)
  }
  const exact = { ...counts(context.exact), checks: context.exact }
  const candidate = { ...counts(context.candidate), checks: context.candidate }
  const ready = exact.failed === 0 && candidate.failed === 0 && candidate.missing === 0 && candidate.required > 0
  candidate.status = !observe ? 'missing-capability' : candidate.failed > 0 ? 'failed' : 'verified'
  return {
    schemaVersion: manifest.schemaVersion,
    scope: 'P0 authored checkpoints and exact incremental equivalence',
    coverage: { schedules: SCHEDULES, presentation: 'named checkpoints', exhaustiveTwoChunkSplits: false, lifecycle: ['open', 'ended'] },
    verdict: ready ? 'READY' : 'NOT READY',
    fixtureCount: manifest.fixtures.length,
    checkpointCount: manifest.fixtures.reduce((total, fixture) => total + fixture.checkpoints.length, 0),
    fixtureHash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    baseline: manifest.baseline,
    references: manifest.references,
    toolchain: { node: process.version, platform: process.platform, architecture: process.arch },
    exact,
    candidate,
  }
}
