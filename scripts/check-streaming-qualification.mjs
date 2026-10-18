import { init, MarkdownDocument } from '../js/index.js'
import assert from 'node:assert/strict'
import { streamingArtifacts } from './streaming-artifacts.mjs'
import manifest from '../tests/streaming/fixtures.mjs'
import { loadQualificationCorpus } from '../tests/streaming/corpus.mjs'
import { runStreamingQualification } from '../tests/streaming/qualification.mjs'

assert.equal(manifest.fixtures.length, 33, 'qualification requires all 33 original fixtures')
assert.equal(manifest.fixtures.reduce((total, fixture) => total + fixture.checkpoints.length, 0), 76, 'qualification requires every independently authored checkpoint')
await init()
const corpus = loadQualificationCorpus()
const report = runStreamingQualification(MarkdownDocument, manifest, { corpus })
report.artifacts = streamingArtifacts()
console.log(JSON.stringify(report, null, 2))
if (report.verdict !== 'READY') {
  const failures = report.exact.failed + report.presentation.failed + report.authored.exact.failed + report.authored.presentation.failed
  console.error(`Streaming qualification: ${failures} failed checks, ${report.presentation.missing + report.authored.presentation.missing} missing checks`)
  process.exitCode = failures > 0 ? 1 : 2
}
