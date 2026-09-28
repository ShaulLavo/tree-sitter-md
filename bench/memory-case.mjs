// Each process owns a fresh shared runtime, so earlier cases cannot absorb memory growth.
import { readFileSync } from 'node:fs'
import { init, MarkdownDocument, memoryBytes } from '../js/index.js'

const [file, scope] = process.argv.slice(2)
const text = readFileSync(new URL('./docs/' + file, import.meta.url), 'utf8')
await init({ resolver: process.env.WASM ? readFileSync(process.env.WASM) : undefined })
const base = memoryBytes()
const doc = new MarkdownDocument()
doc.setText(text)
const afterParse = memoryBytes() - base
doc.decorations(0, scope === 'all' ? text.length : Math.min(text.length, 6000))
const afterDecorations = memoryBytes() - base
doc.dispose()
console.log(JSON.stringify({ afterParse, afterDecorations }))
