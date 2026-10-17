import { init, MarkdownDocument } from '../js/index.js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import manifest from '../tests/streaming/fixtures.mjs'
import { runFixtureMatrix } from '../tests/streaming/driver.mjs'

await init()
const report = runFixtureMatrix(MarkdownDocument, manifest)
const require = createRequire(import.meta.url)
const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const runtime = JSON.parse(readFileSync(join(dirname(require.resolve('web-tree-sitter')), 'package.json'), 'utf8'))
report.artifacts = {
  packageVersion: metadata.version,
  runtimeVersion: runtime.version,
  runtimePin: metadata.overrides['web-tree-sitter'],
  wasm: Object.fromEntries(['tree-sitter-md.wasm', 'tree-sitter-markdown.wasm'].map(name => [
    name, createHash('sha256').update(readFileSync(new URL('../' + name, import.meta.url))).digest('hex'),
  ])),
}
console.log(JSON.stringify(report, null, 2))
if (report.verdict !== 'READY') {
  console.error(`Streaming qualification: ${report.exact.failed} exact failures, ${report.candidate.failed} presentation failures, ${report.candidate.missing} missing presentation checks`)
  process.exitCode = report.exact.failed + report.candidate.failed > 0 ? 1 : 2
}
