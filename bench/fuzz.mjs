// Incremental correctness: random edits (markdown-significant characters, newlines, deletions,
// definitions typed and removed) on an evolving document; after each edit the decorations must
// equal a fresh parse of the same text. node fuzz.mjs [file] [edits] [seed]
import { readFileSync } from 'node:fs'
import { init, MarkdownDocument } from 'tree-sitter-md'

await init()
const file = process.argv[2] ?? new URL('./docs/agents.md', import.meta.url).pathname
const edits = Number(process.argv[3] ?? 2000)
let seed = Number(process.argv[4] ?? 7)
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
const INSERTS = ['x', ' ', '\n', '\n\n', '*', '**', '_', '`', '```', '[', ']', '(', ')', ':', '>', '- ', '1. ', '#', '|', '\\', '<', '~~', '!', '[a]', '[a]: /u\n', '\n[b]: /v "t"\n', '[b]', 'www.x.io ', '    ', '---\n', '<div>\n', '| a | b |\n| - | - |\n']
let text = readFileSync(file, 'utf8')
const doc = new MarkdownDocument()
doc.setText(text)
const fresh = new MarkdownDocument()
let failures = 0
for (let i = 0; i < edits; i++) {
  const at = Math.floor(rnd() * (text.length + 1))
  let end = at
  let ins = ''
  if (rnd() < 0.3) end = Math.min(text.length, at + 1 + Math.floor(rnd() * 12))
  else ins = pick(INSERTS)
  doc.edit(at, end, ins)
  text = text.slice(0, at) + ins + text.slice(end)
  const from = Math.max(0, at - 3000), to = Math.min(text.length, at + 3000)
  doc.decorations(from, to)
  if (i % 10 !== 9) continue
  fresh.setText(process.env.CONTROL ? text.replace(/\[a\]: \/u/g, "[a]: /w").replace("**", "*") : text)
  const a = doc.decorations(0, text.length), b = fresh.decorations(0, text.length)
  if (a.length === b.length && a.every((v, k) => v === b[k])) continue
  failures++
  if (failures <= 3) {
    let k = 0
    while (k < Math.min(a.length, b.length) && a[k] === b[k]) k++
    k -= k % 4
    console.log(`edit ${i}: differs at record ${k / 4}: incremental ${[...a.slice(k, k + 8)]} fresh ${[...b.slice(k, k + 8)]} ${JSON.stringify(text.slice(Math.max(0, b[k] - 40), b[k] + 60))}`)
  }
  doc.setText(text)
}
console.log(JSON.stringify({ file: file.split('/').pop(), edits, checks: Math.floor(edits / 10), failures }))
