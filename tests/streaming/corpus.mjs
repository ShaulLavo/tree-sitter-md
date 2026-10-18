import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

export const SCHEDULE_SEEDS = [0x12345678, 0x9e3779b9, 0x243f6a88, 0xb7e15162, 0xdeadbeef, 0x10203040, 0x6a09e667, 0xbb67ae85]
export const CORPUS_OPTIONS = { gfm: true, cjk: true, math: true }

const CHAT = [
  [0, '1c81d2301ce491f3fcfef4d5fbabb5910ef3e263d518eb5ddb036ac5343f7840', 'short ordinary prose'],
  [12, '6c300254f1a33758141c6c9b9c5158a5b06fa5ded7eff816a0bc455832be793d', 'longest message, headings, lists, fenced code and Unicode'],
  [23, 'ae085c17bcb8caa1fae7f0e00bf596ba13a1558cb781cb8aade8d9e1da70cf54', 'implementation report with inline code and lists'],
  [25, '4f0614f484695393b798843c39050adcc228a69dd2223f80ef705d9b13bf1b2d', 'architecture discussion with nested prose'],
  [31, '10ac7b2f54e1a1282acf06a923c3d1cee9c1123d96c8b8dab340cefa8dc268ab', 'research report with links and inline code'],
  [38, '9f0d9aaf1a7e781943eedbbf1c4de2d42ba57016db28b6b84f7e1e3ef701a2d1', 'long research headings and lists'],
  [42, '741aeac88441abd96b0fcdfa4f5ad7dbc6aad71d414192e702cf9b1eab06d30a', 'long domain design with headings'],
  [48, '55c51c142b12b3cbda7eefe0e690de1f2d66544c9c95c9e3668897ac1b0e490a', 'bold report labels, links and lists'],
  [60, '40b83fa71242da64747f7e2dace5980b38eb33e5775a5f9c6c7b4040bcbc9d27', 'short Unicode apostrophe prose'],
  [72, '15d5721bf5d8c2d288403dcdec0367d07a2a25ccfb7a275b6b6c6e44492ca900', 'Unicode quotation and inline code'],
  [75, '148fbb65230b0854264686796e2afa8916c1044876469ce0711f6785cec46194', 'GFM table and Unicode punctuation'],
  [84, '62d283ed2b47f3cd8290f8066c37d0914ade358d66f9470188f85d8d01ed4389', 'literal underscore marker response'],
  [132, '3c81fb0e06eaa356304f15e1ae0254217e8e281a7287d8b6b8984d9529b29e0e', 'late-corpus ordinary Unicode prose'],
  [133, '9122ba733af39fa8ec01cae1948f998b1a1b0c313e882ef9c9c0b0583167e1c1', 'late-corpus GFM table and inline code'],
  [144, 'f5357d013710f4468d9276c53cd9dcbf65e312d44019bcd8454d68218aeb76d4', 'late-corpus short Unicode prose'],
  [182, '0ecc08c01bfbf990430bedb923ebc8013ad860b30107189e3540848ecc972845', 'last message, long diagnostic narrative'],
]

const REPOSITORIES = [
  ['platform/docs/documents/library-survey.md', '643389bd663a2339d26ce0431262f94fb5dd2970432712a3fd4b58b00accdc5b', '14,927 UTF-16 units, links, tables and fenced examples'],
  ['editor/PERFORMANCE_TRACE_PLAN.md', '1642125c624183669dce201c569e47443134ea22f819ecf50097ccbb5ed5dfbd', '31,131 UTF-16 units, long lists and code examples'],
  ['platform/docs/t3code-chat-parity-gap-analysis.md', '720bfeb8071e89b95144cc846a5068004ec851b72fe364d00475908b0a812602', '87,467 UTF-16 units, large chat parity tables and links'],
]

export const CORPUS_PROVENANCE = {
  chat: { path: 'bench/corpus/chat.json', count: 183, sha256: '2c5c01ed08af3c921c8c500b6c9f50d9e48d39480bedc91355dc88377e9adbf1' },
  repository: { path: 'bench/corpus/repositories.json.gz', count: 497, sha256: '3076387b77e3270914425b04895501e232ec1c3ec54de6af2005bb35966c69cd' },
  selection: 'Pinned purposeful development set: short and long prose, both observed table messages, fenced code, links, Unicode, and early/middle/late messages. Repository documents span 14k–87k UTF-16 units. This is a development corpus, not an unseen holdout.',
  gaps: ['167 unselected chat messages and 494 unselected repository documents', 'Corpus schedules cover bounded received prefixes; only the 33 original short fixtures have exhaustive prefixes and two-chunk splits', 'UTF-8 transport decoder splits are outside the UTF-16 string API'],
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function sourceIdentity(source) {
  return { utf16Length: source.length, utf16Sha256: sha256(Buffer.from(source, 'utf16le')) }
}

function readCorpus(kind, compressed) {
  const identity = CORPUS_PROVENANCE[kind]
  const bytes = readFileSync(new URL('../../' + identity.path, import.meta.url))
  assert.equal(sha256(bytes), identity.sha256, kind + ' corpus artifact hash changed')
  const rows = JSON.parse((compressed ? gunzipSync(bytes) : bytes).toString('utf8'))
  assert.equal(rows.length, identity.count, kind + ' corpus denominator changed')
  return rows
}

function selectedFixture(kind, source, id, hash, selectionReason) {
  assert.equal(typeof source, 'string', 'selected corpus source is missing: ' + id)
  assert.equal(sha256(source), hash, 'selected corpus source changed: ' + id)
  return { id, source, options: CORPUS_OPTIONS, kind, sha256: hash, selectionReason, ...sourceIdentity(source) }
}

export function loadQualificationCorpus() {
  const chat = readCorpus('chat', false)
  const repository = new Map(readCorpus('repository', true).map(row => [row.name, row.text]))
  const messages = CHAT.map(([index, hash, why]) => selectedFixture('chat', chat[index], 'chat/' + index, hash, why))
  const documents = REPOSITORIES.map(([id, hash, why]) => selectedFixture('repository', repository.get(id), id, hash, why))
  return messages.concat(documents)
}

function nextRandom(state) {
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return state >>> 0
}

export function seededSchedule(source, seed, maximumChunks) {
  assert.ok(Number.isSafeInteger(seed) && seed > 0 && seed <= 0xffffffff, 'seed must be a nonzero unsigned 32-bit integer')
  assert.ok(Number.isSafeInteger(maximumChunks) && maximumChunks >= 2, 'multichunk schedule needs at least two chunks')
  assert.ok(source.length >= 2, 'selected multichunk source must have at least two UTF-16 units')
  const count = Math.min(maximumChunks, Math.max(2, Math.floor(source.length / 3)))
  const cuts = []
  let state = seed
  for (let index = 1; index < count; index++) {
    const start = Math.floor((index - 1) * (source.length - 1) / (count - 1)) + 1
    const end = Math.floor(index * (source.length - 1) / (count - 1)) + 1
    state = nextRandom(state)
    cuts.push(start + state % (end - start))
  }
  return { id: 'seed-' + seed.toString(16).padStart(8, '0'), seed, cuts: cuts.concat([source.length]) }
}
