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
  ['- > `a\n\tb`', 'a\n  b'], ['-  - `a\n\tb`', 'a\n b'],
]
for (const [source, expected] of literals) test('inline sourceValue ' + JSON.stringify(source), () => {
  for (const input of [undefined, 'open', 'ended']) {
    const code = nodes(read(source, input), 'code')[0]
    assert.equal(code.sourceValue, expected)
    assertCodeSourceMap(source, code)
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
  assertCodeSourceMap(source, code)
  assert.deepEqual(code.sourceMap.runs, [
    { kind: 'copy', valueStart: 0, length: 1, tokenOffset: 1 },
    { kind: 'atom', valueStart: 1, valueLength: 1, tokenOffset: 2, sourceLength: 2 },
    { kind: 'copy', valueStart: 2, length: 1, tokenOffset: 4 },
  ])
  assert.deepEqual(code.range, { start: 14, end: 20 })
})

const footnoteLiterals = [
  ['lazy one', '[^x]: `a{eol} b`', 'a{eol} b', 'a  b'],
  ['lazy two', '[^x]: `a{eol}  b`', 'a{eol}  b', 'a   b'],
  ['required indent', '[^x]: `a{eol}    b`', 'a{eol}b', 'a     b'],
  ['extra indent', '[^x]: `a{eol}     b`', 'a{eol} b', 'a      b'],
  ['inner list lazy', '[^x]: - `a{eol}   b`', 'a{eol} b', 'a  b'],
  ['inner quote', '[^x]: > `a{eol}    >  b`', 'a{eol} b', 'a  b'],
  ['outer quote lazy', '> [^x]: `a{eol}>  b`', 'a{eol} b'],
  ['outer list tab', '- [^x]: `a{eol}\t   b`', 'a{eol} b', 'a \t   b'],
  ['nested footnote', '[^x]: [^y]: `a{eol}     b`', 'a{eol} b', 'a      b'],
  ['nested quote footnote', '[^x]: > [^y]: `a{eol}    >  b`', 'a{eol} b'],
]
function checkFootnoteLiteral(source, expected, canonical) {
  for (const input of [undefined, 'open', 'ended']) {
    const code = nodes(read(source, input), 'code')[0]
    assert.ok(code, 'canonical code node exists')
    assert.equal(code.sourceValue, expected)
    assertCodeSourceMap(source, code)
    assert.equal(code.value, canonical)
    assert.deepEqual(code.range, { start: source.indexOf('`'), end: source.length })
  }
}
for (const eol of ['\n', '\r\n', '\r']) {
  for (const [name, template, value, crValue] of footnoteLiterals.filter(row => eol !== '\r' || row.length === 4)) test('footnote source mapping ' + name + ' ' + JSON.stringify(eol), () => {
    checkFootnoteLiteral(template.replaceAll('{eol}', eol), value.replaceAll('{eol}', eol), eol === '\r' ? crValue : 'a b')
  })
}

test('lazy footnote literal mapping retains the accepted referenced definition', () => {
  const source = '[^x]: `a\n b`\n\n[^x]'
  for (const input of [undefined, 'open', 'ended']) {
    const code = nodes(read(source, input), 'code')[0]
    assert.equal(code.sourceValue, 'a\n b')
    assert.equal(code.value, 'a b')
    assert.deepEqual(code.range, { start: 6, end: 12 })
  }
})

function assertCodeSourceMap(source, code) {
  const map = code.sourceMap
  assert.ok(map, 'inline code requires a producer-owned sourceMap')
  assert.equal(map.value, code.sourceValue)
  assert.equal(map.tokenLength, code.range.end - code.range.start)
  assert.ok(Array.isArray(map.runs))
  let valueEnd = 0, sourceEnd = 0
  for (const run of map.runs) {
    assert.equal(run.valueStart, valueEnd)
    assert.ok(Number.isSafeInteger(run.tokenOffset) && run.tokenOffset >= sourceEnd)
    const valueLength = run.kind === 'copy' ? run.length : run.valueLength
    const sourceLength = run.kind === 'copy' ? run.length : run.sourceLength
    assert.ok(Number.isSafeInteger(valueLength) && valueLength > 0)
    assert.ok(Number.isSafeInteger(sourceLength) && sourceLength > 0)
    assert.ok(run.tokenOffset + sourceLength <= map.tokenLength)
    assert.ok(run.kind === 'copy' || run.kind === 'atom')
    if (run.kind === 'copy') {
      assert.equal(map.value.slice(run.valueStart, run.valueStart + run.length),
        source.slice(code.range.start + run.tokenOffset, code.range.start + run.tokenOffset + run.length))
    }
    valueEnd += valueLength; sourceEnd = run.tokenOffset + sourceLength
  }
  assert.equal(valueEnd, map.value.length)
}

for (const eol of ['\n', '\r\n', '\r']) test('producer witness distinguishes inline code EOL placement ' + JSON.stringify(eol), () => {
  for (const source of ['`one' + eol + 'two three`', '`one two' + eol + 'three`']) {
    for (const input of [undefined, 'open', 'ended']) {
      const code = nodes(read(source, input), 'code')[0]
      assertCodeSourceMap(source, code)
      assert.deepEqual(code.sourceMap.runs, [{ kind: 'copy', valueStart: 0, length: source.length - 2, tokenOffset: 1 }])
    }
  }
})

test('footnote producer witnesses retained lazy spaces and local virtual tabs', () => {
  for (const source of ['[^x]: `a\n b`', '- [^x]: `a\n\t   b`', '[^x]: [^y]: `a\n     b`']) {
    for (const input of [undefined, 'open', 'ended']) {
      const code = nodes(read(source, input), 'code')[0]
      assertCodeSourceMap(source, code)
    }
  }
})


function assertRepeatedCodeWitness(document, prefix) {
  const source = prefix + '`one\ntwo three` and `one two\nthree`'
  document.setText(source)
  const code = nodes(document.semantics().root, 'code')
  assert.equal(code.length, 2)
  for (const entry of code) assertCodeSourceMap(source, entry)
  assert.notEqual(code[0].range.start, code[1].range.start)
  assert.equal(code[0].sourceMap.runs[0].tokenOffset, 1)
  assert.equal(code[1].sourceMap.runs[0].tokenOffset, 1)
}

test('producer witness follows equal occurrences and repeated setText calls', () => {
  const document = new MarkdownDocument()
  try {
    for (const prefix of ['', '🙂\ud800 before\n\n']) assertRepeatedCodeWitness(document, prefix)
  } finally { document.dispose() }
})

for (const source of ['``a`b``', '`&amp; \\ 🙂 é 👩‍💻`', '\ud800 `x\udc00🙂` \udc00', '`a\0b`']) test('producer UTF16 witness ' + JSON.stringify(source), () => {
  for (const input of [undefined, 'open', 'ended']) assertCodeSourceMap(source, nodes(read(source, input), 'code')[0])
})

test('decoder rejects missing, stale, partial, unordered and nonnumeric code maps', () => {
  const source = '`abc`'
  const mutations = [
    code => { delete code.sourceMap },
    code => { code.sourceMap.value = 'stale' },
    code => { code.sourceMap.tokenLength = 99 },
    code => { code.sourceMap.runs = [] },
    code => { code.sourceMap.runs[0].valueStart = 1 },
    code => { code.sourceMap.runs[0].length = 0 },
    code => { code.sourceMap.runs[0].length = 4 },
    code => { code.sourceMap.runs[0].tokenOffset = -1 },
    code => { code.sourceMap.runs[0].tokenOffset = 0.5 },
    code => { code.sourceMap.runs[0].kind = 'unknown' },
    code => { code.sourceMap.runs = [{ kind: 'copy', valueStart: 0, length: 1, tokenOffset: 1 }, { kind: 'copy', valueStart: 1, length: 2, tokenOffset: 1 }] },
    code => { code.sourceMap.runs = [{ kind: 'atom', valueStart: 0, valueLength: 3, tokenOffset: 1, sourceLength: 0 }] },
    code => { code.sourceMap.runs = [{ kind: 'atom', valueStart: 0, valueLength: 3, tokenOffset: 1, sourceLength: 0.5 }] },
    code => { code.sourceMap.runs[0].length = Number.MAX_SAFE_INTEGER },
    code => { code.sourceMap.runs.push({ kind: 'atom', valueStart: 3, valueLength: 1, tokenOffset: 1, sourceLength: 1 }) },
  ]
  for (const mutate of mutations) {
    const root = read(source)
    mutate(nodes(root, 'code')[0])
    assert.throws(() => decodeSemanticRoot(JSON.stringify(root), source.length), TypeError)
  }
})

for (const [source, tabOffset] of [
  ['- `a\n\tb`', 3], ['> `a\n>\tb`', 4],
  ['> [^x]: `a\n>\t\tb`', 5], ['- [^x]: `a\n\t\tb`', 4],
  ['[^x]: > `a\n    >\tb`', 8], ['> [^x]: [^y]: `a\n>\t\tb`', 5],
]) test('virtual tab has one exact local contribution ' + JSON.stringify(source), () => {
  for (const input of [undefined, 'open', 'ended']) {
    const code = nodes(read(source, input), 'code')[0]
    assert.equal(code.sourceValue, 'a\n  b')
    assert.equal(code.value, 'a b')
    assertCodeSourceMap(source, code)
    assert.deepEqual(code.sourceMap.runs, [
      { kind: 'copy', valueStart: 0, length: 2, tokenOffset: 1 },
      { kind: 'atom', valueStart: 2, valueLength: 2, tokenOffset: tabOffset, sourceLength: 1 },
      { kind: 'copy', valueStart: 4, length: 1, tokenOffset: tabOffset + 1 },
    ])
    assert.equal(source[code.range.start + tabOffset], '\t')
  }
})

for (const eol of ['\n', '\r\n', '\r']) test('newline padding has no literal contribution ' + JSON.stringify(eol), () => {
  const source = '`' + eol + '🙂' + eol + 'x' + eol + '`'
  const code = nodes(read(source), 'code')[0]
  assert.equal(code.sourceValue, '🙂' + eol + 'x')
  assertCodeSourceMap(source, code)
  assert.deepEqual(code.sourceMap.runs, [{ kind: 'copy', valueStart: 0, length: 3 + eol.length, tokenOffset: 1 + eol.length }])
})

test('local NUL atom and surrogate copies compose inside a footnote', () => {
  const source = '[^x]: `🙂\n \ud800\0b`'
  const code = nodes(read(source), 'code')[0]
  assert.equal(code.sourceValue, '🙂\n \ud800�b')
  assertCodeSourceMap(source, code)
  assert.deepEqual(code.sourceMap.runs, [
    { kind: 'copy', valueStart: 0, length: 5, tokenOffset: 1 },
    { kind: 'atom', valueStart: 5, valueLength: 1, tokenOffset: 6, sourceLength: 1 },
    { kind: 'copy', valueStart: 6, length: 1, tokenOffset: 7 },
  ])
})

test('an edit before equal code occurrences shifts ranges without changing token maps', () => {
  const document = new MarkdownDocument()
  const source = '`one\ntwo three` and `one two\nthree`'
  const prefix = '🙂\ud800 before\n\n'
  try {
    document.setText(source)
    const before = nodes(document.semantics().root, 'code')
    document.edit(0, 0, prefix)
    const after = nodes(document.semantics().root, 'code')
    assert.equal(after.length, before.length)
    for (let i = 0; i < before.length; i++) {
      assert.equal(after[i].range.start, before[i].range.start + prefix.length)
      assert.deepEqual(after[i].sourceMap, before[i].sourceMap)
      assertCodeSourceMap(prefix + source, after[i])
    }
  } finally { document.dispose() }
})
