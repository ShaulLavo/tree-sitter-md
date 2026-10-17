import { init, MarkdownDocument } from '../js/index.js'
import { readFixtureManifest, runFixtureMatrix } from '../tests/streaming/driver.mjs'

await init()
const report = runFixtureMatrix(MarkdownDocument, readFixtureManifest())
console.log(JSON.stringify(report, null, 2))
if (report.candidate.status !== 'ready') {
  console.error(`Streaming candidate is not ready; missing ${report.candidate.missing.join(', ')}`)
  process.exitCode = 2
}
