// Real content against micromark + GFM: the repository docs Plan 176 used (Platform c130dd35a,
// Editor 74e76be) and the assistant messages in corpus/chat.json (override with CHAT=path).
// Same normalizer and ignore set as Plan 176.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { parser as lezerBase, GFM } from '@lezer/markdown'
import { init, MarkdownDocument } from 'tree-sitter-md'
import { fromMdast, fromLezer, fromTsmd, compare } from './constructs.mjs'

await init()
const lezerGfm = lezerBase.configure(GFM)
const REPOS = [
  ['platform', process.env.PLATFORM ?? '/work/projects/platform', 'c130dd35a'],
  ['editor', process.env.EDITOR_REPO ?? '/work/projects/Editor', '74e76be'],
]
const docs = []
for (const [repo, root, rev] of REPOS) {
  const files = execSync(`git -C ${root} ls-tree -r --name-only ${rev}`, { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.md'))
  for (const f of files) docs.push({ name: `${repo}/${f}`, kind: 'repo', text: execSync(`git -C ${root} show ${rev}:${JSON.stringify(f).slice(1, -1)}`, { encoding: 'utf8', maxBuffer: 1 << 26 }) })
}
const chatPath = process.env.CHAT ?? new URL('./corpus/chat.json', import.meta.url)
JSON.parse(readFileSync(chatPath, 'utf8')).forEach((text, i) => docs.push({ name: `chat/${i}`, kind: 'chat', text }))

const ignore = new Set(['tight', 'math', 'imath'])
const doc = new MarkdownDocument({ gfm: true })
const stats = {}
const samples = {}
const frontmatter = (d) => /^(---|\+\+\+)\n/.test(d.text)
for (const d of docs) {
  const expected = fromMdast(d.text, fromMarkdown(d.text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }))
  doc.setText(d.text)
  const ours = fromTsmd(d.text, doc.decorations(0, d.text.length))
  const lz = fromLezer(d.text, lezerGfm.parse(d.text), { refcheck: true })
  for (const [name, actual] of [['tree-sitter-md', ours], ['lezer', lz]]) {
    const c = compare(expected, actual, { ignore })
    const s = (stats[`${d.kind}:${name}`] ??= { docs: 0, pass: 0, expected: 0, missing: {}, extra: {}, frontmatterDocs: 0 })
    s.docs++
    if (c.pass) s.pass++
    else if (frontmatter(d)) s.frontmatterDocs++
    s.expected += expected.filter((x) => !ignore.has(x.split(/[@:]/)[0])).length
    for (const [list, key] of [[c.missing, 'missing'], [c.extra, 'extra']]) {
      for (const m of list) {
        const k = m.split(/[@:]/)[0]
        s[key][k] = (s[key][k] ?? 0) + 1
        const bucket = (samples[`${name}-${k}-${key}`] ??= [])
        if (bucket.length < 12) bucket.push(sample(d, m))
      }
    }
  }
}
function sample(d, entry) {
  const m = /@(\d+)-(\d+)/.exec(entry)
  if (!m) return `${d.name} ${entry}`
  const a = Number(m[1]), b = Number(m[2])
  return `${d.name} ${entry} ${JSON.stringify(d.text.slice(Math.max(0, a - 30), Math.min(d.text.length, b + 30)))}`
}
mkdirSync(new URL('./out/', import.meta.url), { recursive: true })
writeFileSync(new URL('./out/corpus-stats.json', import.meta.url), JSON.stringify(stats, null, 1))
writeFileSync(new URL('./out/corpus-samples.json', import.meta.url), JSON.stringify(samples, null, 1))
for (const [k, s] of Object.entries(stats)) {
  const miss = Object.values(s.missing).reduce((a, b) => a + b, 0)
  const extra = Object.values(s.extra).reduce((a, b) => a + b, 0)
  console.log(`${k}: docs ${s.pass}/${s.docs} identical (${s.frontmatterDocs} of the rest start with frontmatter); constructs ${s.expected}; missing ${miss} ${JSON.stringify(s.missing)}; extra ${extra} ${JSON.stringify(s.extra)}`)
}
