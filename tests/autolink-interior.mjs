import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument, Kind } from '../js/index.js'
import { semanticHtml } from './semantic-html.mjs'

await init()

function read(source, input, options) {
  const document = new MarkdownDocument(options)
  try {
    document.setText(source)
    const root = input ? document.presentation({ input }).root : document.semantics().root
    return { root, decorations: Array.from(document.decorations(0, source.length)) }
  } finally { document.dispose() }
}
function nodes(root, type) {
  const children = ['children', 'items', 'rows', 'cells'].flatMap(field => root[field] ?? [])
  return (root.type === type ? [root] : []).concat(children.flatMap(child => nodes(child, type)))
}

function linkDecorations(source, decorations) {
  const links = []
  for (let at = 0; at < decorations.length; at += 4) {
    if (decorations[at + 2] === Kind.Link) links.push(source.slice(decorations[at], decorations[at + 1]))
  }
  return links
}

test('GFM URL interior delimiters do not close surrounding strong emphasis', () => {
  const source = 'A **see(https://exa**mple.test/a)ded** message.\n\n'
  for (const input of [undefined, 'open', 'ended']) {
    const { root, decorations } = read(source, input)
    const strong = nodes(root, 'strong')[0]
    const link = nodes(root, 'link')[0]
    assert.deepEqual(strong.range, { start: 2, end: 38 })
    assert.deepEqual(link, {
      type: 'link', range: { start: 8, end: 36 },
      url: 'https://exa**mple.test/a)ded', title: null, origin: 'gfm-autolink',
      sourceValue: 'https://exa**mple.test/a)ded', sourceUrl: 'https://exa**mple.test/a)ded',
      children: [{ type: 'text', range: { start: 8, end: 36 }, value: 'https://exa**mple.test/a)ded' }],
    })
    assert.deepEqual(linkDecorations(source, decorations), ['https://exa**mple.test/a)ded'])
  }
})

const literals = [
  ['**https://example.test/a**b**', 'https://example.test/a**b'],
  ['*https://example.test/a*b*', 'https://example.test/a*b'],
  ['_https://example.test/a_b_', 'https://example.test/a_b'],
  ['~~https://example.test/a~~b~~', 'https://example.test/a~~b'],
  ['**https://exa**mple.test/a**', 'https://exa**mple.test/a'],
  ['**www.example.test/a**b**', 'www.example.test/a**b'],
  ['**WWW.example.test/a**b**', 'WWW.example.test/a**b'],
  ['**https://example.test/a(b))**', 'https://example.test/a(b)'],
  ['**https://example.test/a)b**', 'https://example.test/a)b'],
  ['**https://example.test/a,**', 'https://example.test/a'],
  ['**https://example.test/a?!:;**', 'https://example.test/a'],
  ['**https://example.test/a\\*b**', 'https://example.test/a\\*b'],
  ['**https://example.test/a`b**', 'https://example.test/a`b'],
  ['**https://example.test/a[b**', 'https://example.test/a[b'],
  ['**https://example.test/a]b**', 'https://example.test/a]b'],
  ['**https://example.test/a<x**', 'https://example.test/a'],
  ['**https://example.test/a?x=1&amp;y=2**', 'https://example.test/a?x=1&amp;y=2'],
  ['**www.example.test/&#58;@b**', 'www.example.test/&#58;@b'],
  ['中文 **https://exa**mple.test/a** 中文', 'https://exa**mple.test/a'],
]
function assertLiteral(source, literal, cjk, input) {
  const { root } = read(source, input, { cjk })
  const link = nodes(root, 'link')[0]
  const scheme = /^www\./i.test(literal) ? 'http://' : ''
  const value = literal.replaceAll('&amp;', '&').replaceAll('&#58;', ':')
  assert.equal(link.origin, 'gfm-autolink')
  assert.equal(link.sourceValue, literal)
  assert.equal(link.sourceUrl, scheme + literal)
  assert.equal(link.url, scheme + value)
  assert.deepEqual(link.range, { start: source.indexOf(literal), end: source.indexOf(literal) + literal.length })
  assert.deepEqual(link.children, [{ type: 'text', range: link.range, value }])
}
for (const [source, literal] of literals) test('GFM URL punctuation and source contract ' + source, () => {
  for (const cjk of [false, true]) {
    for (const input of [undefined, 'open', 'ended']) assertLiteral(source, literal, cjk, input)
  }
})

test('CJK URL boundaries retain following punctuation and emphasis', () => {
  const source = '**see(https://exa**mple.test/a。)ded**'
  assertLiteral(source, 'https://exa**mple.test/a', true)
  assertLiteral(source, 'https://exa**mple.test/a。)ded', false)
  assert.equal(semanticHtml(read(source, undefined, { cjk: true })), '<p><strong>see(<a href="https://exa**mple.test/a">https://exa**mple.test/a</a>。)ded</strong></p>\n')
})

test('literal URLs do not replace explicit links, code or disabled GFM', () => {
  for (const source of ['[https://example.test/a**b](target)', '[https://example.test/a**b][id]\n\n[id]: target']) {
    const links = nodes(read(source).root, 'link')
    assert.equal(links.length, 1)
    assert.equal(links[0].origin, 'markdown')
    assert.equal(links[0].url, 'target')
  }
  assert.equal(nodes(read('`https://example.test/a**b`').root, 'link').length, 0)
  assert.equal(nodes(read('**https://example.test/a**b**', undefined, { gfm: false }).root, 'link').length, 0)
})


test('failed URL candidates preserve the next inline delimiter', () => {
  for (const source of ['**`T`:**', '**With [Fluid](target):**', '**`T`w**']) {
    const { root } = read(source)
    assert.equal(nodes(root, 'strong').length, 1)
    assert.equal(nodes(root, 'emphasis').length, 0)
    assert.deepEqual(nodes(root, 'strong')[0].range, { start: 0, end: source.length })
  }
})


function assertInvalidWww(source, cjk) {
  for (const input of [undefined, 'open', 'ended']) {
    const { root, decorations } = read(source, input, { cjk })
    assert.deepEqual(nodes(root, 'link'), [], source)
    assert.deepEqual(linkDecorations(source, decorations), [], source)
  }
}
test('trailing delimiters cannot validate an incomplete www domain', () => {
  const sources = ['**www.**', '**www.!**', '**www.?**', '**WWW.**', '*www.*',
    '_www._', '~~www.~~', '**www.,**', '**www.:**', '**www.;**', '**www.)**', '**www.]**']
  for (const source of sources) {
    assertInvalidWww(source, false)
    assertInvalidWww(source, true)
  }
  assert.deepEqual(nodes(read('**www.**').root, 'strong')[0].children,
    [{ type: 'text', range: { start: 2, end: 6 }, value: 'www.' }])
})

function assertLabelShape(source, label, cjk) {
  for (const input of [undefined, 'open', 'ended']) {
    const { root } = read(source, input, { cjk })
    const link = nodes(root, 'link')[0]
    const start = source.indexOf(label)
    assert.equal(link.origin, 'markdown')
    assert.equal(link.url, 'target')
    assert.deepEqual(link.children,
      [{ type: 'text', range: { start, end: start + label.length }, value: label }], source)
  }
}
test('disabled literal autolinks do not fragment Markdown link labels', () => {
  const labels = ['https://example.test/a', 'www.example.test/a', 'x www.example.test/a',
    'https://one.test/a https://two.test/b']
  for (const label of labels) {
    assertLabelShape('[' + label + '](target)', label, false)
    assertLabelShape('**[' + label + '](target)**', label, true)
    assertLabelShape('[' + label + '][id]\n\n[id]: target', label, true)
  }
})
