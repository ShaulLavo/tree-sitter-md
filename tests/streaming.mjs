import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { init, MarkdownDocument } from '../js/index.js'
import manifest from './streaming/fixtures.mjs'
import { chunksFor, runFixtureMatrix, validateFixtureManifest } from './streaming/driver.mjs'

validateFixtureManifest(manifest)
await init()
const report = runFixtureMatrix(MarkdownDocument, manifest)

for (const fixture of manifest.fixtures) {
  test('independent ended roots and incremental prefixes: ' + fixture.id, () => {
    const failures = report.exact.checks.filter(check => check.fixture === fixture.id && check.status === 'failed')
    assert.deepEqual(failures, [])
  })
}

test('every planned behavior has independently authored nested checkpoint expectations', () => {
  assert.equal(validateFixtureManifest(manifest), 33)
  assert.equal(report.checkpointCount, 76)
  assert.equal(new Set(manifest.fixtures.flatMap(fixture => fixture.behaviors)).size, manifest.requiredBehaviors.length)
  assert.deepEqual(manifest.requiredBehaviors, [
    'ordinary-text', 'nested-emphasis', 'literal-delimiters', 'unclosed-code',
    'bare-delimiters', 'open-fence', 'pending-link', 'pending-image',
    'table-reclassification', 'bare-markers', 'setext-reclassification',
    'incomplete-html', 'pending-math', 'currency', 'references',
  ])
})

test('UTF-16 appends really split a surrogate pair while codepoint appends preserve it', () => {
  const source = '🙂 **שלום**'
  const units = chunksFor(source, 'utf16')
  assert.equal(units[0], '\ud83d')
  assert.equal(units[1], '\ude42')
  assert.equal(chunksFor(source, 'codepoint')[0], '🙂')
  for (const schedule of ['whole', 'utf16', 'codepoint', 'midpoint']) assert.equal(chunksFor(source, schedule).join(''), source)
})

test('the Textual replay uses the three recorded chunks and exercises unresolved and resolved uses', () => {
  const fixture = manifest.fixtures.find(value => value.id === 'late-reference')
  const chunks = chunksFor(fixture.source, fixture.replay)
  assert.deepEqual(chunks, ['[late][id]\n\n', 'Tail\n\n', '[id]: https://example.com\n'])
  const checks = report.exact.checks.filter(check => check.fixture === fixture.id && check.schedule === fixture.replay.id)
  assert.ok(checks.some(check => check.at === 18))
  assert.ok(checks.some(check => check.at === fixture.source.length))
})

test('every required candidate checkpoint stays visible in the denominator', () => {
  assert.ok(report.candidate.required >= report.checkpointCount)
  assert.equal(report.candidate.checks.filter(check => check.schedule === 'checkpoint').length, report.checkpointCount)
  if (typeof MarkdownDocument.prototype.presentation === 'function') return
  assert.equal(report.candidate.status, 'missing-capability')
  assert.equal(report.candidate.missing, report.candidate.required)
  assert.equal(report.candidate.passed, 0)
  assert.equal(report.verdict, 'NOT READY')
})

function controlManifest() {
  const fixtures = manifest.fixtures.filter(fixture => fixture.id === 'ordinary-without-newline')
  return { ...manifest, fixtures, requiredBehaviors: ['ordinary-text'] }
}

function ordinaryObservation(document, input) {
  return { ...document.semantics(), source: 'Hello chat', input, provisional: [], suppressed: [], references: [] }
}

test('a valid control observer is evaluated through the real qualification path', () => {
  const result = runFixtureMatrix(MarkdownDocument, controlManifest(), { observePresentation: ordinaryObservation })
  assert.equal(result.exact.failed, 0)
  assert.equal(result.candidate.failed, 0)
  assert.equal(result.candidate.passed, result.candidate.required)
  assert.equal(result.verdict, 'READY')
})

test('method presence and a malformed observation cannot make qualification ready', () => {
  const result = runFixtureMatrix(MarkdownDocument, controlManifest(), { observePresentation: () => ({}) })
  assert.equal(result.candidate.status, 'failed')
  assert.equal(result.candidate.failed, result.candidate.required)
  assert.equal(result.verdict, 'NOT READY')
})

test('a stale input mode is rejected even when source and exact tree are unchanged', () => {
  const result = runFixtureMatrix(MarkdownDocument, controlManifest(), {
    observePresentation: document => ordinaryObservation(document, 'open'),
  })
  assert.ok(result.candidate.checks.some(check => check.input === 'ended' && check.status === 'failed'))
  assert.equal(result.verdict, 'NOT READY')
})

test('a stale presentation source revision is rejected through the matrix', () => {
  const result = runFixtureMatrix(MarkdownDocument, controlManifest(), {
    observePresentation: (document, input) => ({ ...ordinaryObservation(document, input), revision: 1 }),
  })
  assert.ok(result.candidate.failed > 0)
  assert.equal(result.verdict, 'NOT READY')
})

test('a wrong profile is rejected through the matrix', () => {
  const result = runFixtureMatrix(MarkdownDocument, controlManifest(), {
    observePresentation: (document, input) => ({ ...ordinaryObservation(document, input), profile: 'commonmark' }),
  })
  assert.ok(result.candidate.failed > 0)
  assert.equal(result.verdict, 'NOT READY')
})

test('invalid fixture structure and missing behavior coverage fail before qualification', () => {
  const invalid = structuredClone(manifest)
  invalid.fixtures[0].checkpoints[0].expected.root.children = 'flat text'
  assert.throws(() => validateFixtureManifest(invalid), assert.AssertionError)
  const missing = { ...manifest, requiredBehaviors: manifest.requiredBehaviors.concat(['absent-behavior']) }
  assert.throws(() => validateFixtureManifest(missing), /missing required behavior/)
})

test('qualification CLI preserves denominators, artifact identity, and incomplete-profile status', () => {
  const command = fileURLToPath(new URL('../scripts/check-streaming.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [command], { encoding: 'utf8', timeout: 10000 })
  assert.equal(result.error, undefined)
  const output = JSON.parse(result.stdout)
  assert.equal(output.fixtureHash, report.fixtureHash)
  assert.equal(output.candidate.required, report.candidate.required)
  assert.equal(output.candidate.missing, report.candidate.missing)
  assert.equal(output.toolchain.node, process.version)
  assert.match(output.artifacts.runtimePin, /^github:ShaulLavo\/tree-sitter-x#[a-f0-9]{40}$/u)
  for (const hash of Object.values(output.artifacts.wasm)) assert.match(hash, /^[a-f0-9]{64}$/u)
  const failures = output.exact.failed + output.candidate.failed
  assert.equal(result.status, failures > 0 ? 1 : output.candidate.missing > 0 ? 2 : 0)
})
