// Linear memory grows in 64 KB pages and never shrinks; measure each case in a fresh process.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('./memory-case.mjs', import.meta.url))
const measure = (file, scope) => JSON.parse(execFileSync(process.execPath, [entry, file, scope], { encoding: 'utf8' }))
const mb = (n) => +(n / 1048576).toFixed(2)
for (const file of ['agents.md', 'big.md']) {
  const text = readFileSync(new URL('./docs/' + file, import.meta.url), 'utf8')
  const view = measure(file, 'viewport')
  const all = measure(file, 'all')
  console.log(JSON.stringify({ file, chars: text.length, parseMB: mb(view.afterParse), viewportDecoratedMB: mb(view.afterDecorations), wholeDocumentDecoratedMB: mb(all.afterDecorations) }))
}
