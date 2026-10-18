import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import { decodeSemanticRoot } from '../js/semantic.js'

await init()

function read(source, input, options) {
  const document = new MarkdownDocument(options)
  try {
    document.setText(source)
    return input ? document.presentation({ input }).root : document.semantics().root
  } finally { document.dispose() }
}
function nodes(root, type) {
  const children = ['children', 'items', 'rows', 'cells'].flatMap(field => root[field] ?? [])
  return (root.type === type ? [root] : []).concat(children.flatMap(child => nodes(child, type)))
}
const literals = [
  ['`a\n b`', 'a\n b'], ['`a\n  b`', 'a\n  b'],
  ['`a\r\n b`', 'a\r\n b'], ['`a\r b`', 'a\r b'],
  ['> `a\n>  b`', 'a\n b'], ['- `a\n   b`', 'a\n b'],
  ['> `a\n> \tb`', 'a\n\tb'], ['- `a\n  \tb`', 'a\n\tb'],
  ['` a `', 'a'], ['`\r\na\r\n`', 'a'], ['` \na\n `', '\na\n'],
  ['`  `', '  '], ['` \n `', ' \n '], ['`` `x` ``', '`x`'],
  ['> - `a\r\n>    b`', 'a\r\n b'], ['- `a\n\tb`', 'a\n  b'],
  ['`🙂\n \ud83d\0`', '🙂\n \ud83d�'],
  ['`\0 \ud83d`', '� \ud83d'],
  ['> `a\n  b`', 'a\n  b'], ['- `a\n b`', 'a\n b'],
  ['> `a\n>\tb`', 'a\n  b'], ['> - `a\n>\tb`', 'a\nb'],
  ['- > `a\n   b`', 'a\n b'], ['- - `a\n   b`', 'a\n b'],
  ['> - > `a\n>    b`', 'a\n b'], ['> `a\n    > b`', 'a\nb'],
  ['> > `a\n    >    > b`', 'a\nb'], ['- > `a\n      >  b`', 'a\n b'],
  ['- > `a\r\n   b`', 'a\r\n b'], ['> `a\r\n    > b`', 'a\r\nb'],
  ['- > `a\r   b`', 'a\r b'], ['> `a\r    > b`', 'a\rb'],
]
for (const [source, expected] of literals) test('inline sourceValue ' + JSON.stringify(source), () => {
  for (const input of [undefined, 'open', 'ended']) {
    const code = nodes(read(source, input), 'code')[0]
    assert.equal(code.sourceValue, expected)
    assert.deepEqual(code.range, { start: source.indexOf('`'), end: source.length })
  }
})

test('sourceValue does not change canonical inline normalization', () => {
  for (const source of ['`a\n b`', '`a\n  b`', '> `a\n>  b`', '- `a\n   b`']) {
    assert.equal(nodes(read(source), 'code')[0].value, 'a b')
  }
})
test('temporary EOF code has sourceValue without a fabricated closing run', () => {
  const code = nodes(read('> `a\r\n>  b', 'open'), 'code')[0]
  assert.equal(code.value, 'a b')
  assert.equal(code.sourceValue, 'a\r\n b')
})

test('GFM literals expose raw URL and text without changing canonical payloads', () => {
  for (const prefix of ['https://', 'www.']) {
    const literal = prefix + 'example.test/a?a=1&amp;b=2'
    const link = nodes(read(literal), 'link')[0]
    const scheme = prefix === 'www.' ? 'http://' : ''
    assert.equal(link.origin, 'gfm-autolink')
    assert.equal(link.url, scheme + literal.replace('&amp;', '&'))
    assert.equal(link.children[0].value, literal.replace('&amp;', '&'))
    assert.equal(link.sourceUrl, scheme + literal)
    assert.equal(link.sourceValue, literal)
  }
})

for (const [source, sourceUrl] of [
  ['www.a.test/&#58;@b', 'http://www.a.test/&#58;@b'],
  ['www.a.test/a@b', 'http://www.a.test/a@b'],
  ['person@example.test', 'mailto:person@example.test'],
]) test('GFM literal scheme ' + source, () => {
  for (const input of [undefined, 'open', 'ended']) {
    const link = nodes(read(source, input), 'link')[0]
    assert.equal(link.origin, 'gfm-autolink')
    assert.equal(link.sourceUrl, sourceUrl)
    assert.equal(link.sourceValue, source)
  }
})

test('literal scheme metadata leaves the canonical destination unchanged', () => {
  for (const input of [undefined, 'open', 'ended']) {
    const link = nodes(read('www.a.test/&#58;@b', input), 'link')[0]
    assert.equal(link.url, 'http://www.a.test/:@b')
    assert.equal(link.children[0].value, 'www.a.test/:@b')
  }
})
test('Markdown and angle autolinks retain CommonMark decoding and origin', () => {
  const url = 'https://example.test/a?a=1&amp;b=2'
  for (const options of [{ gfm: false }, { gfm: true }]) {
    for (const [source, origin] of [['[x](' + url + ')', 'markdown'], ['<' + url + '>', 'autolink']]) {
      const link = nodes(read(source, undefined, options), 'link')[0]
      assert.equal(link.origin, origin)
      assert.equal(link.url, url.replace('&amp;', '&'))
      assert.equal('sourceUrl' in link, false)
      assert.equal('sourceValue' in link, false)
    }
  }
})
test('GFM origin does not discard authored ranges inside unmatched brackets', () => {
  for (const source of ['[https://example.test/a]', '[x: https://example.test/a', 'x(https://example.test/a)']) {
    const link = nodes(read(source), 'link')[0]
    assert.equal(link.origin, 'gfm-autolink')
    assert.deepEqual(link.range, { start: source.indexOf('https://'), end: source.indexOf('https://') + 22 })
    assert.deepEqual(link.children[0].range, link.range)
  }
})
test('decoder requires the source metadata promised by the public union', () => {
  const root = read('`a`')
  delete root.children[0].children[0].sourceValue
  assert.throws(() => decodeSemanticRoot(JSON.stringify(root), 3), TypeError)
  const links = read('https://example.test/a')
  delete links.children[0].children[0].sourceUrl
  assert.throws(() => decodeSemanticRoot(JSON.stringify(links), 22), TypeError)
})

test('single-line code retains existing cell escape handling', () => {
  const source = '| a |\n|---|\n| `x\\|y` |'
  const code = nodes(read(source), 'code')[0]
  assert.equal(code.value, 'x|y')
  assert.equal(code.sourceValue, 'x|y')
  assert.deepEqual(code.range, { start: 14, end: 20 })
})
