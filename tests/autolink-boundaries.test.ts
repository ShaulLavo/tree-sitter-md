import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import type { SemanticRoot, SemanticBlock, SemanticInline, SemanticListItem, SemanticTableRow, SemanticTableCell,
  PresentationRoot, PresentationBlock, PresentationInline, PresentationListItem, PresentationTableRow, PresentationTableCell } from '../js/semantic.js'
import fixtures from './fixtures/autolink-boundaries.json' with { type: 'json' }

await init()

type Node = SemanticRoot | SemanticBlock | SemanticInline | SemanticListItem | SemanticTableRow | SemanticTableCell
  | PresentationRoot | PresentationBlock | PresentationInline | PresentationListItem | PresentationTableRow | PresentationTableCell

function children(node: Node): readonly Node[] {
  if ('children' in node) return node.children
  if ('items' in node) return node.items
  if ('rows' in node) return node.rows
  if ('cells' in node) return node.cells
  return []
}

function nodes(node: Node): Node[] {
  return [node].concat(children(node).flatMap(nodes))
}

function links(root: Node) {
  return nodes(root).flatMap(node => {
    if (node.type !== 'link' || node.origin !== 'gfm-autolink') return []
    assert.equal(node.sourceUrl, node.sourceValue)
    assert.equal(node.url, node.sourceUrl)
    assert.deepEqual(node.children, [{ type: 'text', value: node.sourceValue, range: node.range }])
    return [{ value: node.sourceValue, href: encodeURI(node.url), range: node.range }]
  })
}

function attention(root: Node) {
  return nodes(root).flatMap(node => {
    if (node.type !== 'strong' && node.type !== 'emphasis' && node.type !== 'delete') return []
    return [{ type: node.type, range: node.range }]
  })
}

function roots(document: MarkdownDocument, source: string) {
  const open = document.presentation({ input: 'open' })
  const ended = document.presentation({ input: 'ended' })
  assert.equal(open.source, source)
  assert.equal(ended.source, source)
  return [document.semantics().root, open.root, ended.root]
}

function checkFixture(item: typeof fixtures[number]): void {
  assert.equal(item.source.length, item.identity.utf16Units)
  assert.equal(createHash('sha256').update(Buffer.from(item.source, 'utf16le')).digest('hex'), item.identity.utf16LeSha256)
  const document = new MarkdownDocument({ gfm: true, cjk: true, math: true })
  const fresh = new MarkdownDocument({ gfm: true, cjk: true, math: true })
  try {
    document.setText(item.source)
    const before = roots(document, item.source)
    assert.deepEqual(links(before[0]), item.links, item.id)
    assert.deepEqual(links(before[2]), item.links, item.id)
    document.edit(item.source.length, item.source.length, ' ')
    document.edit(item.source.length, item.source.length + 1, '')
    fresh.setText(item.source)
    assert.deepEqual(roots(document, item.source), roots(fresh, item.source))
    assert.deepEqual(roots(document, item.source), before)
  } finally {
    document.dispose()
    fresh.dispose()
  }
}

for (const item of fixtures) test('saved exact/ended URL boundary ' + item.id, () => checkFixture(item))

for (const item of fixtures.filter(item => !item.id.startsWith('230/'))) {
  test('saved native open URL boundary ' + item.id, () => {
    const document = new MarkdownDocument({ gfm: true, cjk: true, math: true })
    try {
      document.setText(item.source)
      const root = document.presentation({ input: 'open' }).root
      assert.deepEqual(links(root), item.links)
      if (item.id.startsWith('236/')) assert.deepEqual(attention(root), item.attention)
    } finally { document.dispose() }
  })
}

for (const item of fixtures.filter(item => item.id.endsWith('/completed'))) {
  test('saved surrounding attention ' + item.id, () => {
    const document = new MarkdownDocument({ gfm: true, cjk: true, math: true })
    try {
      document.setText(item.source)
      assert.deepEqual(attention(document.semantics().root), item.attention)
      assert.deepEqual(attention(document.presentation({ input: 'ended' }).root), item.attention)
    } finally { document.dispose() }
  })
}

for (const item of fixtures.filter(item => item.id.startsWith('230/'))) {
  test('native open math ownership ' + item.id, () => {
    const document = new MarkdownDocument({ gfm: true, cjk: true, math: true })
    try {
      document.setText(item.source)
      const open = document.presentation({ input: 'open' })
      const math = nodes(open.root).find(node => node.type === 'pendingMath')
      assert.equal(math?.type, 'pendingMath')
      assert.deepEqual(math?.range, { start: 2, end: item.source.length })
      assert.deepEqual(links(open.root), [])
      assert.equal(open.provisional[0]?.reason, 'unclosed-math')
    } finally { document.dispose() }
  })
}

for (const source of ['Visit https://e', '参照 https://e']) {
  test('partial explicit HTTP host ' + source, () => {
    const document = new MarkdownDocument({ gfm: true, cjk: true, math: true })
    try {
      document.setText(source)
      const start = source.indexOf('https://')
      const expected = [{ value: 'https://e', href: 'https://e', range: { start, end: source.length } }]
      for (const root of roots(document, source)) assert.deepEqual(links(root), expected)
    } finally { document.dispose() }
  })
}

for (const source of ['https://', 'https://?x', 'https://_host', 'https://-host',
  'https://.host', 'https://[host]', 'https://>host', 'ftp://example.test',
  'javascript://example.test', 'xhttps://example.test', 'www.', 'www.foo_bar.test',
  'user@example']) {
  test('literal URL safety control ' + source, () => {
    const document = new MarkdownDocument({ gfm: true, cjk: true, math: true })
    try {
      document.setText(source)
      for (const root of roots(document, source)) assert.deepEqual(links(root), [])
    } finally { document.dispose() }
  })
}

for (const source of ['https://例子󠄀.test/a', 'https://例子󠄀/a', 'https://example.test/a>b']) {
  test('explicit HTTP Unicode and inline angle control ' + source, () => {
    const document = new MarkdownDocument({ gfm: true, cjk: true, math: true })
    try {
      document.setText(source)
      const expected = [{ value: source, href: encodeURI(source), range: { start: 0, end: source.length } }]
      for (const root of roots(document, source)) assert.deepEqual(links(root), expected)
    } finally { document.dispose() }
  })
}

for (const [source, url] of [['user@example.test', 'mailto:user@example.test'],
  ['user@foo_bar.test', 'mailto:user@foo_bar.test'], ['www.example.test', 'http://www.example.test']]) {
  test('www and email acceptance control ' + source, () => {
    const document = new MarkdownDocument({ gfm: true, cjk: true, math: true })
    try {
      document.setText(source)
      for (const root of roots(document, source)) {
        const found = nodes(root).filter(node => node.type === 'link')
        assert.deepEqual(found.map(node => node.url), [url])
        assert.deepEqual(found.map(node => node.range), [{ start: 0, end: source.length }])
      }
    } finally { document.dispose() }
  })
}
