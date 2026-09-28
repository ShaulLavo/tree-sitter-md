import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const sources = [
  ['platform', process.argv[2], 'c130dd35a202dd06ccd160bd5ed0789c889315c2'],
  ['editor', process.argv[3], '74e76bef2af674ad80b3c13024fa47f692e2bb7c'],
]
assert(sources.every(([, root]) => root), 'Usage: node scripts/snapshot-repositories.mjs PLATFORM_CHECKOUT EDITOR_CHECKOUT')
const documents = []
for (const [repo, root, revision] of sources) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const files = git('ls-tree', '-r', '--name-only', revision).trim().split('\n').filter(file => file.endsWith('.md'))
  for (const file of files) documents.push({ name: `${repo}/${file}`, text: git('show', `${revision}:${file}`) })
}
const allowed = JSON.parse(readFileSync(new URL('../tests/repository-differences.json', import.meta.url)))
assert.deepEqual(documents.map(({ name, text }) => ({ name, sha256: createHash('sha256').update(text).digest('hex') })),
  allowed.documents.map(({ name, sha256 }) => ({ name, sha256 })))
writeFileSync(new URL('../bench/corpus/repositories.json.gz', import.meta.url), gzipSync(JSON.stringify(documents), { level: 9 }))
console.log(`Recorded ${documents.length} pinned repository documents`)
