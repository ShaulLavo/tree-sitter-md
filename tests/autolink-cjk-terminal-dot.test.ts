import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument, Kind } from '../js/index.js'
import type { SemanticInline, PresentationInline } from '../js/semantic.js'

await init()

type Inline = SemanticInline | PresentationInline
function links(nodes: readonly Inline[]): Extract<Inline, { type: 'link' }>[] {
  return nodes.flatMap(node => {
    if (node.type === 'link') return [node]
    if ('children' in node) return links(node.children)
    return []
  })
}

function expectLinks(document: MarkdownDocument, source: string, literal: string | null, url = literal): void {
  const exact = document.semantics().root
  const open = document.presentation({ input: 'open' })
  const ended = document.presentation({ input: 'ended' })
  assert.equal(open.source, source)
  assert.equal(ended.source, source)
  const ranges = literal ? [{ start: source.indexOf(literal), end: source.indexOf(literal) + literal.length }] : []
  for (const root of [exact, open.root, ended.root]) {
    const paragraph = root.children[0]
    assert.equal(paragraph?.type, 'paragraph')
    if (paragraph?.type !== 'paragraph') return
    const found = links(paragraph.children)
    assert.deepEqual(found.map(link => link.url), url ? [url] : [])
    assert.deepEqual(found.map(link => link.range), ranges)
    assert.deepEqual(found.map(link => 'sourceValue' in link ? link.sourceValue : null), literal ? [literal] : [])
    assert.deepEqual(found.map(link => 'sourceUrl' in link ? link.sourceUrl : null), url ? [url] : [])
    assert.deepEqual(found.map(link => link.children), literal ? [[{ type: 'text', range: ranges[0], value: literal }]] : [])
  }
  const decorations = document.decorations(0, source.length)
  const actual = []
  for (let i = 0; i < decorations.length; i += 4) {
    if (decorations[i + 2] === Kind.Link) actual.push({ start: decorations[i], end: decorations[i + 1] })
  }
  assert.deepEqual(actual, ranges)
}

function check(source: string, literal: string | null, cjk = true, url = literal): void {
  const document = new MarkdownDocument({ gfm: true, cjk })
  try {
    document.setText(source)
    expectLinks(document, source, literal, url)
  } finally { document.dispose() }
}

for (const source of ['https://dotless.。', 'https://foo_bar.test.。', 'www.。',
  'https://dotless.，tail', 'https://foo_bar.test.？！', 'www.！']) {
  test('reject CJK terminal-dot domain ' + source, () => check(source, null))
}

for (const punctuation of ['。', '．', '，', '、', '？', '！', '：', '；', '（', '）',
  '【', '】', '「', '」', '『', '』', '〈', '〉', '《', '》']) {
  test('trim exposed ASCII punctuation before ' + punctuation, () => {
    check('前😀 https://example.test.!' + punctuation + '後', 'https://example.test')
  })
}

for (const [source, literal, url] of [
  ['前😀 https://例子.test.。後', 'https://例子.test', 'https://例子.test'],
  ['www.example.test.。後', 'www.example.test', 'http://www.example.test'],
  ['https://foo_bar.example.test.。後', 'https://foo_bar.example.test', 'https://foo_bar.example.test'],
  ['https://example.test/a(b).。後', 'https://example.test/a(b)', 'https://example.test/a(b)'],
]) {
  test('preserve explicit and dotted controls ' + source, () => {
    check(source, literal, true, url)
  })
}

function expectExplicit(source: string, url: string): void {
  const document = new MarkdownDocument({ gfm: true, cjk: true })
  try {
    document.setText(source)
    for (const root of [document.semantics().root, document.presentation({ input: 'open' }).root,
      document.presentation({ input: 'ended' }).root]) {
      const paragraph = root.children[0]
      assert.equal(paragraph?.type, 'paragraph')
      if (paragraph?.type !== 'paragraph') continue
      assert.deepEqual(links(paragraph.children).map(link => link.url), [url])
      assert.deepEqual(links(paragraph.children).map(link => link.range), [{ start: 0, end: source.length }])
    }
    assert.equal(document.presentation({ input: 'ended' }).source, source)
  } finally { document.dispose() }
}
for (const url of ['https://dotless.。', 'https://foo_bar.test.。', 'https://example.test.。']) {
  test('preserve explicit ' + url, () => expectExplicit('[x](' + url + ')', url))
  test('preserve angle ' + url, () => expectExplicit('<' + url + '>', url))
}

for (const [source, literal, url] of [
  ['https://dotless.。', 'https://dotless.。', 'https://dotless.。'],
  ['https://foo_bar.test.。', 'https://foo_bar.test.。', 'https://foo_bar.test.。'],
  ['www.。', 'www.。', 'http://www.。'],
]) test('preserve CJK-off ' + source, () => check(source, literal, false, url))

test('incremental CJK terminal-dot edit and undo retain UTF-16 ranges', () => {
  const document = new MarkdownDocument({ gfm: true, cjk: true })
  const source = '前😀 https://example.test.。後'
  const at = source.indexOf('.test')
  try {
    document.setText(source)
    expectLinks(document, source, 'https://example.test')
    document.edit(at, at + 5, '')
    expectLinks(document, source.slice(0, at) + source.slice(at + 5), null)
    document.edit(at, at, '.test')
    expectLinks(document, source, 'https://example.test')
  } finally { document.dispose() }
})
