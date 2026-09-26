// CommonMark 0.31.2 (652) + GFM extension (24) examples, normalized construct lists against
// micromark's mdast. Same method and normalizer as Plan 176's research (constructs.mjs).
// node spec.mjs [--fail] [--show N]
import spec from 'commonmark-spec'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { parser as lezerBase, GFM } from '@lezer/markdown'
import { init, MarkdownDocument } from 'tree-sitter-md'
import { fromMdast, fromLezer, fromTsmd, compare } from './constructs.mjs'

await init()
const lezerGfm = lezerBase.configure(GFM)
const args = process.argv.slice(2)

function gfmExamples() {
  const data = readFileSync(new URL('./spec/gfm-spec.txt', import.meta.url), 'utf8').replace(/\r\n?/g, '\n').replace(/^<!-- END TESTS -->(.|[\n])*/m, '')
  const out = []
  let section = ''
  let number = 0
  data.replace(/^`{32} example( \w+)?\n([\s\S]*?)^\.\n([\s\S]*?)^`{32}$|^#{1,6} *(.*)$/gm, (_, ext, md, html, sec) => {
    if (sec) { section = sec; return }
    number++
    const tag = (ext ?? '').trim()
    if (tag === '') return
    out.push({ markdown: md.replace(/→/g, '\t'), html: html.replace(/→/g, '\t'), section: `GFM ${section}`, number, ext: tag })
  })
  return out
}

const cm = spec.tests.map((t) => ({ ...t, markdown: t.markdown.replace(/→/g, '\t') }))
const examples = [...cm.map((t) => ({ ...t, gfm: false })), ...gfmExamples().map((t) => ({ ...t, gfm: true }))]
const docs = { false: new MarkdownDocument({ gfm: false }), true: new MarkdownDocument({ gfm: true }) }
const variants = {
  'tree-sitter-md': (t) => {
    const d = docs[t.gfm]
    d.setText(t.markdown)
    return fromTsmd(t.markdown, d.decorations(0, t.markdown.length))
  },
  'lezer+refcheck': (t) => fromLezer(t.markdown, (t.gfm ? lezerGfm : lezerBase).parse(t.markdown), { refcheck: true }),
}
const results = []
for (const t of examples) {
  const mdast = t.gfm ? fromMarkdown(t.markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) : fromMarkdown(t.markdown)
  const expected = fromMdast(t.markdown, mdast)
  const row = { number: t.number, section: t.section, markdown: t.markdown, v: {} }
  for (const [name, fn] of Object.entries(variants)) row.v[name] = compare(expected, fn(t))
  results.push(row)
}
const names = Object.keys(variants)
const sections = new Map()
for (const r of results) {
  const s = sections.get(r.section) ?? { n: 0, ...Object.fromEntries(names.map((n) => [n, 0])) }
  s.n++
  for (const n of names) if (r.v[n].pass) s[n]++
  sections.set(r.section, s)
}
const tot = { n: 0, ...Object.fromEntries(names.map((n) => [n, 0])) }
const lines = [`| Section | n | ${names.join(' | ')} |`, `| --- | --: | ${names.map(() => '--:').join(' | ')} |`]
for (const [name, s] of sections) {
  for (const k in tot) tot[k] += s[k]
  lines.push(`| ${name} | ${s.n} | ${names.map((n) => s[n]).join(' | ')} |`)
}
lines.push(`| **Total** | ${tot.n} | ${names.map((n) => `${tot[n]} (${((100 * tot[n]) / tot.n).toFixed(1)}%)`).join(' | ')} |`)
mkdirSync(new URL('./out/', import.meta.url), { recursive: true })
writeFileSync(new URL('./out/spec-table.md', import.meta.url), lines.join('\n') + '\n')
writeFileSync(new URL('./out/spec-results.json', import.meta.url), JSON.stringify(results, null, 1))
console.log(lines.join('\n'))
const failing = results.filter((r) => !r.v['tree-sitter-md'].pass)
console.log(`\ntree-sitter-md failing: ${failing.map((r) => r.number).join(' ')}`)
if (args.includes('--fail')) {
  for (const r of failing) {
    const v = r.v['tree-sitter-md']
    console.log(`\n#${r.number} ${r.section}\n${JSON.stringify(r.markdown)}\n  missing ${JSON.stringify(v.missing)}\n  extra   ${JSON.stringify(v.extra)}`)
  }
}
