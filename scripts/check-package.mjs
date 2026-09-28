import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build, preview } from 'vite'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
mkdirSync(join(root, 'target'), { recursive: true })
const directory = mkdtempSync(join(root, 'target/package-'))
const run = (command, args, cwd = directory) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const orders = ['host-first', 'markdown-first', 'concurrent']
let server
let browser
try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', directory], root))[0]
  const paths = packed.files.map(file => file.path)
  for (const path of ['js/index.js', 'js/index.d.ts', 'tree-sitter-md.wasm', 'tree-sitter-markdown.wasm', 'LICENSE', 'NOTICE.md']) assert(paths.includes(path), `Missing packed ${path}`)
  assert(paths.some(path => path.startsWith('licenses/')), 'Third-party licenses are missing')
  const host = JSON.parse(readFileSync(join(root, 'package.json'))).dependencies['web-tree-sitter']
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'tree-sitter-md': `file:./${packed.filename}`, 'web-tree-sitter': host } }))
  run('bun', ['install'])
  cpSync(join(root, 'tests/package'), directory, { recursive: true })
  for (const runtime of ['node', 'bun']) {
    for (const order of orders) console.log(`${runtime}: ${run(runtime, ['node.mjs', order]).trim()}`)
  }
  await build({ root: directory, configFile: false, logLevel: 'warn', build: { assetsInlineLimit: 0 } })
  server = await preview({ root: directory, configFile: false, logLevel: 'warn', preview: { host: '127.0.0.1', port: 0, strictPort: true } })
  const address = server.httpServer.address()
  browser = await chromium.launch({ headless: true })
  for (const order of orders) await checkBrowser(order, address.port)
} finally {
  await browser?.close()
  await new Promise(resolve => server ? server.httpServer.close(resolve) : resolve())
  rmSync(directory, { recursive: true, force: true })
}

async function checkBrowser(order, port) {
  const page = await browser.newPage()
  const errors = []
  const assets = new Set()
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    if (response.url().endsWith('.wasm') && response.ok()) assets.add(new URL(response.url()).pathname)
  })
  await page.goto(`http://127.0.0.1:${port}/?order=${order}`)
  await page.waitForFunction(() => window.result || window.failure)
  const result = await page.evaluate(() => ({ result: window.result, failure: window.failure }))
  assert.equal(result.failure, undefined)
  assert.deepEqual(errors, [])
  for (const name of ['web-tree-sitter-', 'tree-sitter-markdown-', 'tree-sitter-md-']) assert([...assets].some(path => path.includes(name)), `Missing browser wasm request: ${name}`)
  console.log(`vite/chromium: ${JSON.stringify(result.result)}, ${assets.size} wasm assets`)
  await page.close()
}
