import { init, MarkdownDocument } from '../js/index.js'
import manifest from '../tests/streaming/fixtures.mjs'
import { runFixtureMatrix } from '../tests/streaming/driver.mjs'
import { streamingArtifacts } from './streaming-artifacts.mjs'

await init()
const report = runFixtureMatrix(MarkdownDocument, manifest)
report.artifacts = streamingArtifacts()
console.log(JSON.stringify(report, null, 2))
if (report.verdict !== 'READY') {
  console.error(`Streaming qualification: ${report.exact.failed} exact failures, ${report.candidate.failed} presentation failures, ${report.candidate.missing} missing presentation checks`)
  process.exitCode = report.exact.failed + report.candidate.failed > 0 ? 1 : 2
}
