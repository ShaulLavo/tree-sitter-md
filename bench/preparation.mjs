// Run with Bun; every sample uses a fresh browser context and complete source.
import { readFileSync } from 'node:fs'
import { resolve, join, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const ownRoot = resolve(import.meta.dirname, '..')
const roots = process.argv.slice(2).map(path => resolve(path))
if (!roots.length) roots.push(ownRoot)
const playwright = process.env.PLAYWRIGHT ?? '/work/projects/platform/scripts/node_modules/playwright/index.mjs'
const { chromium } = await import(pathToFileURL(playwright))
const mime = { '.wasm': 'application/wasm', '.js': 'text/javascript', '.html': 'text/html' }
const cases = [
  ['ordinary', readFileSync(join(ownRoot, 'bench/docs/agents.md'), 'utf8')],
  ['1mb', readFileSync(join(ownRoot, 'bench/docs/big.md'), 'utf8')],
  ['giant-paragraph', 'plain text with **bold** and [ref] '.repeat(32000) + '\n\n[ref]: /target\n'],
  ['dense-references', 'text [ref2048] **bold**\n\n' + Array.from({ length: 4096 }, (_, i) => `[ref${i}]: /path/${i}\n\n`).join('')],
  ['giant-fence', '```ts\n' + 'const text = 123;\n'.repeat(60000) + '```\n'],
]
let currentRoot = roots[0]
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname
    const relative = path === '/' ? '/bench/web/preparation.html' : path
    const base = relative.startsWith('/bench/web/preparation.') ? ownRoot : currentRoot
    return new Response(Bun.file(join(base, relative)), {
      headers: { 'content-type': mime[extname(relative)] ?? 'application/octet-stream', 'cache-control': 'no-store' },
    })
  },
})
const browser = await chromium.launch()
try {
  for (const root of roots) {
    currentRoot = root
    const payload = ['js/index.js', 'tree-sitter-md.wasm', 'tree-sitter-markdown.wasm', 'node_modules/web-tree-sitter/web-tree-sitter.js', 'node_modules/web-tree-sitter/web-tree-sitter.wasm'].map(file => {
      const bytes = readFileSync(join(root, file))
      return { file, raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length }
    })
    console.log(JSON.stringify({ root, browser: browser.version(), payload }))
    for (let round = 0; round < 3; round++) {
      for (const [name, text] of cases) {
        const context = await browser.newContext()
        try {
          const page = await context.newPage()
          await page.goto(`http://127.0.0.1:${server.port}/`)
          await page.waitForFunction(() => typeof window.measurePreparation === 'function')
          const result = await page.evaluate(source => window.measurePreparation(source), text)
          console.log(JSON.stringify({ root, round, name, ...result }))
        } finally {
          await context.close()
        }
      }
    }
  }
} finally {
  await browser.close()
  server.stop()
}
