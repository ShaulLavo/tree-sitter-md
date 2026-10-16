import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium, firefox, webkit } from 'playwright'

const providers = { chromium, firefox, webkit }
const engines = process.argv.slice(2)
if (engines.length === 0) engines.push('chromium')
for (const engine of engines) assert(providers[engine], `Unknown browser: ${engine}`)
const root = resolve(import.meta.dirname, '..')
const runtime = process.env.TREE_SITTER_RUNTIME
const alias = runtime ? [
  { find: /^web-tree-sitter$/, replacement: join(resolve(runtime), 'web-tree-sitter.js') },
  { find: /^web-tree-sitter\/web-tree-sitter\.wasm(?=\?|$)/, replacement: join(resolve(runtime), 'web-tree-sitter.wasm') },
] : []
const binding = process.env.TREE_SITTER_MD_BINDING
if (binding) alias.push({ find: '../../js/index.js', replacement: resolve(binding) })
let directory
let server
let browser
const interrupted = () => { cleanup().finally(() => process.exit(130)) }
process.once('SIGINT', interrupted)
process.once('SIGTERM', interrupted)
try {
  mkdirSync(join(root, 'target'), { recursive: true })
  directory = mkdtempSync(join(root, 'target/semantics-browser-'))
  process.env.TMPDIR = directory
  server = await createServer({ root, configFile: false,
    logLevel: 'warn', resolve: { alias },
    server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [root].concat(runtime ? [resolve(runtime)] : []) } } })
  await server.listen()
  const { port } = server.httpServer.address()
  for (const engine of engines) {
    browser = await providers[engine].launch({ headless: true })
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${port}/tests/browser/semantics.html`)
    await page.waitForFunction(() => window.result || window.failure)
    const { result, failure, rawDecodeRejected } = await page.evaluate(() =>
      ({ result: window.result, failure: window.failure, rawDecodeRejected: window.rawDecodeRejected }))
    assert.equal(failure, undefined, `${engine}: rawDecodeRejected=${rawDecodeRejected}\n${failure}`)
    assert.equal(result.resizable, true)
    console.log(`${engine} ${browser.version()}: ${JSON.stringify(result)}`)
    await browser.close()
    browser = undefined
  }
} finally {
  await cleanup()
  process.off('SIGINT', interrupted)
  process.off('SIGTERM', interrupted)
}

async function cleanup() {
  const closed = await Promise.allSettled([browser?.close(), server?.close()])
  if (directory) rmSync(directory, { recursive: true, force: true })
  for (const result of closed) if (result.status === 'rejected') throw result.reason
}
