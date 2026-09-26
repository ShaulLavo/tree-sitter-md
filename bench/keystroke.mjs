// Keystrokes, first frame and full parse, tree-sitter-md beside lezer on the same text and edits.
// Method matches Plan 176's careful integration (research-176b careful.mjs): the evolving tree,
// 200 one-character inserts after " the " at seeded random positions, then decorations for the
// 60 rows around the edit. node keystroke.mjs [file]
import { readFileSync } from 'node:fs'
import { init, MarkdownDocument } from 'tree-sitter-md'
import { parser as lezerBase, GFM } from '@lezer/markdown'
import { TreeFragment } from '@lezer/common'

const file = process.argv[2] ?? new URL('./docs/big.md', import.meta.url).pathname
const ROWS = 60
const original = readFileSync(file, 'utf8')
const q = (xs, f) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(s.length * f))].toFixed(3) }
const time = (fn) => { const t = performance.now(); const r = fn(); return [performance.now() - t, r] }
const nthNewline = (text, from, n) => { let at = from; for (let i = 0; i < n; i++) { at = text.indexOf('\n', at + 1); if (at < 0) return text.length } return at }

const t0 = performance.now()
await init(process.env.WASM ? readFileSync(process.env.WASM) : undefined)
const out = { file: file.split('/').pop(), chars: original.length, initMs: +(performance.now() - t0).toFixed(1) }
const lz = lezerBase.configure(GFM)

// Warm the JIT and wasm tiers on this text.
for (let i = 0; i < 3; i++) {
  const d = new MarkdownDocument()
  d.setText(original)
  d.decorations(0, 20000)
  d.dispose()
  lz.parse(original)
}

// First frame: the 60-row prefix parsed and decorated.
{
  const pe = nthNewline(original, 0, ROWS) + 1
  const ff = []
  for (let i = 0; i < 7; i++) {
    const d = new MarkdownDocument()
    const [ms] = time(() => { d.setText(original.slice(0, pe)); d.decorations(0, pe) })
    ff.push(ms)
    d.dispose()
  }
  out.firstFrame = q(ff, 0.5)
}
{ const fp = []; for (let i = 0; i < 3; i++) { const d = new MarkdownDocument(); const [ms] = time(() => d.setText(original)); fp.push(ms); d.dispose() } out.fullParse = q(fp, 0.5) }
{ const d = new MarkdownDocument(); d.setText(original); const [ms] = time(() => d.decorations(0, original.length)); out.decorateWholeDocument = +ms.toFixed(1); d.dispose() }

// Open: prefix, then the rest as an append edit, then keystrokes.
let text = original
const doc = new MarkdownDocument()
const prefixEnd = nthNewline(text, 0, ROWS) + 1
doc.setText(text.slice(0, prefixEnd))
doc.decorations(0, prefixEnd)
;[out.restAsAppend] = time(() => doc.edit(prefixEnd, prefixEnd, text.slice(prefixEnd)))
out.restAsAppend = +out.restAsAppend.toFixed(1)
if (process.env.IDLE_REPARSE !== '0') { const [ms] = time(() => doc.reparse()); out.idleReparse = +ms.toFixed(1) }
{ const [ms] = time(() => doc.reparse()); out.unchangedReparse = +ms.toFixed(3) }

let seed = 11
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const edit = [], deco = [], total = [], ats = []
for (let i = 0; i < 200; i++) {
  const at = text.indexOf(' the ', Math.floor(text.length * rnd())) + 1
  if (at < 1) continue
  ats.push(at)
  const from = text.lastIndexOf('\n', Math.max(0, at - 2000)) + 1
  const a = performance.now()
  doc.edit(at, at, 'x')
  const b = performance.now()
  text = text.slice(0, at) + 'x' + text.slice(at)
  const to = nthNewline(text, from, ROWS)
  doc.decorations(from, to)
  const c = performance.now()
  edit.push(b - a); deco.push(c - b); total.push(c - a)
}
out.firstKeystroke = +total[0].toFixed(3)
out.keystroke = { editMedian: q(edit.slice(1), 0.5), decorateMedian: q(deco.slice(1), 0.5), totalMedian: q(total.slice(1), 0.5), totalP95: q(total.slice(1), 0.95), totalMax: q(total.slice(1), 1) }
{
  const check = new MarkdownDocument()
  check.setText(text)
  const a = doc.decorations(0, text.length), b = check.decorations(0, text.length)
  out.editedEqualsFresh = a.length === b.length && a.every((v, i) => v === b[i])
  check.dispose()
}
doc.dispose()

// lezer, same text and same edits
let ltext = original, lt
{ const lf = []; for (let i = 0; i < 3; i++) { const [a, t] = time(() => lz.parse(ltext)); lf.push(a); lt = t } out.lezerFull = q(lf, 0.5) }
{ const stop = nthNewline(ltext, 0, ROWS); const ff = []; for (let i = 0; i < 7; i++) { const [a] = time(() => { const p = lz.startParse(ltext); p.stopAt(stop); while (!p.advance()) {} }); ff.push(a) } out.lezerFirstFrame = q(ff, 0.5) }
let frags = TreeFragment.addTree(lt)
const lzt = []
for (const at of ats) {
  const next = ltext.slice(0, at) + 'x' + ltext.slice(at)
  const a = performance.now()
  const f = TreeFragment.applyChanges(frags, [{ fromA: at, toA: at, fromB: at, toB: at + 1 }])
  lt = lz.parse(next, f); frags = TreeFragment.addTree(lt, f)
  lzt.push(performance.now() - a); ltext = next
}
out.lezerKeystroke = { first: +lzt[0].toFixed(3), median: q(lzt.slice(1), 0.5), p95: q(lzt.slice(1), 0.95) }
console.log(JSON.stringify(out))
