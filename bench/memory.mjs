// Wasm memory per document: growth of linear memory over a fresh process's baseline, for the
// resolver and for web-tree-sitter (which holds the parse tree). Linear memory grows in 64 KB
// pages and never shrinks, so these are high-water marks. web-tree-sitter starts with a 32 MB
// heap, so one tree shows no growth there; a 1 MB document's tree measured about 6 MB of it.
// node memory.mjs [--case file mode]
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const mb = (n) => +(n / 1048576).toFixed(2)

if (process.argv[2] === '--case') {
  // Every linear memory either module creates, whether exported or imported.
  const memories = new Set()
  const NativeMemory = WebAssembly.Memory
  WebAssembly.Memory = new Proxy(NativeMemory, { construct: (target, args) => { const m = new target(...args); memories.add(m); return m } })
  for (const name of ['instantiate', 'instantiateStreaming']) {
    const original = WebAssembly[name]
    WebAssembly[name] = async (...args) => {
      const result = await original(...args)
      const instance = result.instance ?? result
      for (const value of Object.values(instance.exports ?? {})) if (value instanceof NativeMemory) memories.add(value)
      return result
    }
  }
  const { init, MarkdownDocument, memoryBytes } = await import('../js/index.js')
  await init()
  const total = () => [...memories].reduce((sum, m) => sum + m.buffer.byteLength, 0)
  const text = readFileSync(new URL('./docs/' + process.argv[3], import.meta.url), 'utf8')
  const base = total()
  const resolverBase = memoryBytes()
  const doc = new MarkdownDocument()
  doc.setText(text)
  const afterParse = total() - base
  doc.decorations(0, process.argv[4] === 'whole' ? text.length : Math.min(text.length, 6000))
  console.log(JSON.stringify({ afterParse, afterDecorations: total() - base, resolver: memoryBytes() - resolverBase }))
} else {
  const self = fileURLToPath(import.meta.url)
  const measure = (file, mode) => JSON.parse(execFileSync(process.execPath, [self, '--case', file, mode], { encoding: 'utf8' }))
  for (const f of ['agents.md', 'big.md']) {
    const text = readFileSync(new URL('./docs/' + f, import.meta.url), 'utf8')
    const view = measure(f, 'viewport')
    const all = measure(f, 'whole')
    console.log(JSON.stringify({ file: f, chars: text.length, parseMB: mb(view.afterParse), viewportDecoratedMB: mb(view.afterDecorations), wholeDocumentDecoratedMB: mb(all.afterDecorations), resolverWholeMB: mb(all.resolver) }))
  }
}
