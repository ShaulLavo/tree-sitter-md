// Wasm memory per document: a fresh instance per case, growth of linear memory over the empty
// instance. Linear memory grows in 64 KB pages and never shrinks, so this is the high-water mark.
import { readFileSync } from 'node:fs'
const bytes = readFileSync(new URL('../tree-sitter-md.wasm', import.meta.url))
const module = await WebAssembly.compile(bytes)
async function measure(text, wholeDocument) {
  const { exports: w } = await WebAssembly.instantiate(module, {})
  const base = w.memory.buffer.byteLength
  const h = w.tsmd_new(1)
  const ptr = w.tsmd_input(h, text.length)
  const view = new Uint16Array(w.memory.buffer, ptr, text.length)
  for (let i = 0; i < text.length; i++) view[i] = text.charCodeAt(i)
  w.tsmd_set_text(h)
  const afterParse = w.memory.buffer.byteLength - base
  w.tsmd_decorations(h, 0, wholeDocument ? text.length : Math.min(text.length, 6000))
  return { afterParse, afterDecorations: w.memory.buffer.byteLength - base }
}
const mb = (n) => +(n / 1048576).toFixed(2)
for (const f of ['agents.md', 'big.md']) {
  const text = readFileSync(new URL('./docs/' + f, import.meta.url), 'utf8')
  const view = await measure(text, false)
  const all = await measure(text, true)
  console.log(JSON.stringify({ file: f, chars: text.length, parseMB: mb(view.afterParse), viewportDecoratedMB: mb(view.afterDecorations), wholeDocumentDecoratedMB: mb(all.afterDecorations) }))
}
