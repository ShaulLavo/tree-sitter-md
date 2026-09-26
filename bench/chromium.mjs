// Cold load and first frame on Chromium's main thread: fresh context per run, no-store.
// bun chromium.mjs (Playwright from PLAYWRIGHT, default the Platform checkout's copy)
const pw = process.env.PLAYWRIGHT ?? '/work/projects/platform/node_modules/.bun/playwright@1.63.0/node_modules/playwright/index.js'
const { chromium } = await import(pw)
const root = new URL('..', import.meta.url).pathname
const types = { wasm: 'application/wasm', js: 'text/javascript', md: 'text/plain', html: 'text/html' }
const server = Bun.serve({ port: 0, async fetch(req) {
  const path = new URL(req.url).pathname
  const file = path === '/' ? 'bench/web/index.html' : path.startsWith('/docs/') ? 'bench' + path : path.slice(1)
  return new Response(Bun.file(root + file), { headers: { 'cache-control': 'no-store', 'content-type': types[path.split('.').pop()] ?? 'text/html' } })
} })
const browser = await chromium.launch()
const results = []
for (let round = 0; round < 5; round++) {
  for (const [fn, file] of [['run', 'agents.md'], ['run', 'big.md'], ['runLezer', 'agents.md'], ['runLezer', 'big.md']]) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`http://localhost:${server.port}/`)
    await page.waitForFunction(() => window.run)
    results.push({ fn, ...(await page.evaluate(([g, f]) => window[g](f), [fn, file])) })
    await ctx.close()
  }
}
await browser.close()
server.stop()
const med = (xs) => xs.toSorted((a, b) => a - b)[xs.length >> 1]
for (const [fn, file] of [['run', 'agents.md'], ['run', 'big.md'], ['runLezer', 'agents.md'], ['runLezer', 'big.md']]) {
  const rs = results.filter((r) => r.file === file && r.fn === fn)
  console.log(fn === 'run' ? 'tree-sitter-md' : 'lezer', file, JSON.stringify(Object.fromEntries(['load', 'firstFrame', 'rest', 'full', 'warmFull'].map((k) => [k, +med(rs.map((r) => r[k])).toFixed(2)]))))
}
