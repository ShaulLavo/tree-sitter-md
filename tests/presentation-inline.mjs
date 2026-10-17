import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import manifest from './streaming/fixtures.mjs'
import { compareObservation, runFixtureMatrix } from './streaming/driver.mjs'

await init()

const options = { gfm: true, cjk: true, math: true }
const range = (start, end) => ({ start, end })
const node = (type, start, end, fields = {}) => ({ type, range: range(start, end), ...fields })
const text = (value, start, end) => node('text', start, end, { value })
const paragraph = (start, end, children) => node('paragraph', start, end, { children })
const strong = (start, end, children) => node('strong', start, end, { children })
const emphasis = (start, end, children) => node('emphasis', start, end, { children })
const path = ['children', 0, 'children', 0]
const provisional = (path, reason = 'unclosed-delimiter') => ({ path, reason })

function observation(end, children, provisional = [], suppressed = []) {
  return { root: node('root', 0, end, { children }), provisional, suppressed, references: [] }
}

function compare(document, source, expected, input = 'open') {
  const actual = document.presentation({ input })
  compareObservation(actual, expected, { source, input })
  const exact = document.semantics()
  assert.equal(actual.revision, exact.revision)
  assert.equal(actual.profile, exact.profile)
  assert.deepEqual(actual.capabilities, exact.capabilities)
  return actual
}

const inlineIds = new Set([
  'ordinary-without-newline', 'nested-unclosed-emphasis', 'nested-completed-emphasis',
  'escaped-and-nonflanking-markers', 'unclosed-code-content', 'bare-backtick',
  'bare-emphasis', 'pending-link-label', 'pending-link-destination',
  'pending-image-destination', 'pending-display-math', 'currency-remains-literal',
  'cjk-unclosed-emphasis', 'unicode-entities-escapes', 'nul-source-is-retained',
  'nested-container-emphasis-tail', 'completed-code-span', 'completed-link-and-image',
])
const fixtures = manifest.fixtures.filter(fixture => inlineIds.has(fixture.id))
const inlineManifest = {
  ...manifest,
  fixtures,
  requiredBehaviors: Array.from(new Set(fixtures.flatMap(fixture => fixture.behaviors))),
}
const report = runFixtureMatrix(MarkdownDocument, inlineManifest)

for (const fixture of fixtures) {
  test('P2 authored streaming checkpoint matrix: ' + fixture.id, () => {
    const exact = report.exact.checks.filter(check => check.fixture === fixture.id && check.status !== 'passed')
    const candidate = report.candidate.checks.filter(check => check.fixture === fixture.id && check.status !== 'passed')
    assert.deepEqual(exact, [], 'exact incremental and ended expectations must remain intact')
    assert.deepEqual(candidate, [], 'every independently authored P2 prefix must pass')
  })
}

const cases = [
  ['nested emphasis with the inner delimiter completed', '**outside *inside*', [
    paragraph(0, 18, [strong(0, 18, [text('outside ', 2, 10), emphasis(10, 18, [text('inside', 11, 17)])])]),
  ], [provisional(path)]],
  ['a triple run retains native inner-strong ownership', '***inside', [
    paragraph(0, 9, [emphasis(0, 9, [strong(1, 9, [text('inside', 3, 9)])])]),
  ], [provisional(path), provisional(path.concat(['children', 0]))]],
  ['a four-marker run retains two native strong owners', '****inside', [
    paragraph(0, 10, [strong(0, 10, [strong(2, 10, [text('inside', 4, 10)])])]),
  ], [provisional(path), provisional(path.concat(['children', 0]))]],
  ['a partial closing run preserves completed strong inside provisional emphasis', '***inside**', [
    paragraph(0, 11, [emphasis(0, 11, [strong(1, 11, [text('inside', 3, 9)])])]),
  ], [provisional(path)]],
  ['an unmatched underscore inside completed strong stays literal', '**outside _inside**', [
    paragraph(0, 19, [strong(0, 19, [text('outside _inside', 2, 17)])]),
  ], []],
  ['GFM strike delimiters use the configured native resolver', '~~gone', [
    paragraph(0, 6, [node('delete', 0, 6, { children: [text('gone', 2, 6)] })]),
  ], [provisional(path)]],
  ['escaped markers remain literal', '\\*word', [paragraph(0, 6, [text('*word', 0, 6)])], []],
  ['intraword underscores remain literal', 'word_part', [paragraph(0, 9, [text('word_part', 0, 9)])], []],
  ['a marker followed by whitespace does not become an opener', 'word ** next', [paragraph(0, 12, [text('word ** next', 0, 12)])], []],
  ['CJK punctuation follows configured flanking rules', '和**「字', [
    paragraph(0, 5, [text('和', 0, 1), strong(1, 5, [text('「字', 3, 5)])]),
  ], [provisional(['children', 0, 'children', 1])]],
  ['code normalization trims one matching pair of spaces', '` a ', [
    paragraph(0, 4, [node('code', 0, 4, { value: 'a' })]),
  ], [provisional(path, 'unclosed-code')]],
  ['all-space code content is received content', '`   ', [
    paragraph(0, 4, [node('code', 0, 4, { value: '   ' })]),
  ], [provisional(path, 'unclosed-code')]],
  ['code normalization replaces received newlines', '` a\nb ', [
    paragraph(0, 6, [node('code', 0, 6, { value: 'a b' })]),
  ], [provisional(path, 'unclosed-code')]],
  ['a trailing code newline remains received code content', '`a\n', [
    paragraph(0, 3, [node('code', 0, 3, { value: 'a ' })]),
  ], [provisional(path, 'unclosed-code')]],
  ['a mismatched backtick run stays inside received code', '``a`b', [
    paragraph(0, 5, [node('code', 0, 5, { value: 'a`b' })]),
  ], [provisional(path, 'unclosed-code')]],
  ['a pending label retains nested formatting', '[**label', [
    paragraph(0, 8, [node('pendingLink', 0, 8, { children: [strong(1, 8, [text('label', 3, 8)])] })]),
  ], [provisional(path, 'unclosed-link'), provisional(path.concat(['children', 0]))]],
  ['an incomplete destination title exposes no destination or title', '[a](/url "title', [
    paragraph(0, 15, [node('pendingLink', 0, 15, { children: [text('a', 1, 2)] })]),
  ], [provisional(path, 'unclosed-link')]],
  ['invalid destination text stays literal', '[a](url garbage)', [
    paragraph(0, 16, [text('[a](url garbage)', 0, 16)]),
  ], []],
  ['invalid angle destination retains ordinary HTML and text', '[a](<url>x', [
    paragraph(0, 10, [text('[a](', 0, 4), node('html', 4, 9, { value: '<url>' }), text('x', 9, 10)]),
  ], []],
  ['pending inline math keeps literal received TeX', 'p $$\\frac{a', [
    paragraph(0, 11, [text('p ', 0, 2), node('pendingMath', 2, 11, { value: '\\frac{a' })]),
  ], [provisional(['children', 0, 'children', 1], 'unclosed-math')]],
  ['pending math keeps entity and emphasis syntax opaque', 'p $$&amp; *x', [
    paragraph(0, 12, [text('p ', 0, 2), node('pendingMath', 2, 12, { value: '&amp; *x' })]),
  ], [provisional(['children', 0, 'children', 1], 'unclosed-math')]],
  ['pending display math preserves received payload on the opening line', '$$x *a*', [
    node('pendingMath', 0, 7, { value: 'x *a*' }),
  ], [provisional(['children', 0], 'unclosed-math')]],
  ['pending inline math preserves all-space received payload', 'p $$   ', [
    paragraph(0, 7, [text('p ', 0, 2), node('pendingMath', 2, 7, { value: '   ' })]),
  ], [provisional(['children', 0, 'children', 1], 'unclosed-math')]],
  ['provisional paths count autolink and trailing text as separate siblings', 'www.example.org **bold', [
    paragraph(0, 22, [
      node('link', 0, 15, { url: 'http://www.example.org', title: null, children: [text('www.example.org', 0, 15)] }),
      text(' ', 15, 16), strong(16, 22, [text('bold', 18, 22)]),
    ]),
  ], [provisional(['children', 0, 'children', 2])]],
  ['a closed ATX heading keeps unmatched content literal', '# **x #', [
    node('heading', 0, 7, { depth: 1, children: [text('**x', 2, 5)] }),
  ], []],
  ['an open ATX heading retains temporary EOF through trailing spaces', '# **x  ', [
    node('heading', 0, 5, { depth: 1, children: [strong(2, 5, [text('x', 4, 5)])] }),
  ], [provisional(path)]],
  ['trailing ordinary spaces retain temporary EOF eligibility', '**bold  ', [
    paragraph(0, 6, [strong(0, 6, [text('bold', 2, 6)])]),
  ], [provisional(path)]],
  ['one trailing newline retains temporary EOF eligibility', '**bold\n', [
    paragraph(0, 6, [strong(0, 6, [text('bold', 2, 6)])]),
  ], [provisional(path)]],
  ['a blank line closes the earlier leaf', '**bold\n\n', [
    paragraph(0, 6, [text('**bold', 0, 6)]),
  ], []],
  ['earlier closed leaves keep exact unmatched syntax', '**old\n\n**new', [
    paragraph(0, 5, [text('**old', 0, 5)]), paragraph(7, 12, [strong(7, 12, [text('new', 9, 12)])]),
  ], [provisional(['children', 1, 'children', 0])]],
  ['nested UTF-16 ranges preserve astral characters and native ownership', '🙂 **é *字', [
    paragraph(0, 9, [text('🙂 ', 0, 3), strong(3, 9, [text('é ', 5, 7), emphasis(7, 9, [text('字', 8, 9)])])]),
  ], [provisional(['children', 0, 'children', 1]), provisional(['children', 0, 'children', 1, 'children', 1])]],
]

for (const [name, source, children, metadata] of cases) {
  test('native temporary EOF: ' + name, () => {
    const document = new MarkdownDocument(options)
    try {
      document.setText(source)
      compare(document, source, observation(source.length, children, metadata))
      assert.deepEqual(document.presentation({ input: 'ended' }).root, document.semantics().root)
    } finally {
      document.dispose()
    }
  })
}

test('CJK and math speculation honor disabled capabilities', () => {
  const document = new MarkdownDocument({ gfm: true, cjk: false, math: false })
  try {
    document.setText('和**「字')
    compare(document, '和**「字', observation(5, [paragraph(0, 5, [text('和**「字', 0, 5)])]))
    document.setText('p $$x * y')
    compare(document, 'p $$x * y', observation(9, [paragraph(0, 9, [text('p $$x * y', 0, 9)])]))
  } finally {
    document.dispose()
  }
})

test('trailing nested-container prefixes retain the existing leaf source mapping', () => {
  const document = new MarkdownDocument(options)
  const source = '> - **bold\n>   '
  const children = [node('quote', 0, 12, { children: [node('list', 2, 12, {
    ordered: false, start: null, spread: false,
    items: [node('listItem', 2, 10, { spread: false, checked: null, children: [
      paragraph(4, 10, [strong(4, 10, [text('bold', 6, 10)])]),
    ] })],
  })] })]
  try {
    document.setText(source)
    compare(document, source, observation(15, children, [
      provisional(['children', 0, 'children', 0, 'items', 0, 'children', 0, 'children', 0]),
    ]))
  } finally {
    document.dispose()
  }
})

function fresh(source, input) {
  const document = new MarkdownDocument(options)
  try {
    document.setText(source)
    const result = document.presentation({ input })
    return { root: result.root, provisional: result.provisional, suppressed: result.suppressed, references: result.references }
  } finally {
    document.dispose()
  }
}

function comparePrefix(document, source) {
  const exact = document.semantics()
  for (const input of ['open', 'ended']) {
    const result = document.presentation({ input })
    assert.equal(result.source, source)
    assert.equal(result.revision, exact.revision)
    assert.deepEqual({ root: result.root, provisional: result.provisional, suppressed: result.suppressed, references: result.references }, fresh(source, input))
  }
  assert.deepEqual(document.semantics(), exact)
}

function replay(source) {
  const document = new MarkdownDocument(options)
  let received = ''
  try {
    document.setText('')
    for (const unit of Array.from({ length: source.length }, (_, index) => source[index])) {
      document.edit(received.length, received.length, unit)
      received += unit
      comparePrefix(document, received)
    }
  } finally {
    document.dispose()
  }
}

test('every UTF-16 append keeps open, ended and exact reads equal to independent fresh documents', () => {
  for (const [, source] of cases) replay(source)
})

test('open and exact reads, edits, sibling documents and retained snapshots stay independent', () => {
  const document = new MarkdownDocument(options)
  const sibling = new MarkdownDocument(options)
  const fixture = fixtures.find(fixture => fixture.id === 'nested-unclosed-emphasis')
  const open = fixture.checkpoints.find(check => check.id === 'final-open').expected
  const ended = fixture.checkpoints.find(check => check.id === 'final-ended').expected
  try {
    document.setText(fixture.source)
    const exact = document.semantics()
    const retained = compare(document, fixture.source, open)
    const saved = structuredClone(retained)
    compare(document, fixture.source, ended, 'ended')
    assert.deepEqual(document.semantics(), exact)
    assert.deepEqual(compare(document, fixture.source, open), retained)
    document.reparse()
    assert.deepEqual(compare(document, fixture.source, open), retained)
    sibling.setText('**sibling')
    compare(sibling, '**sibling', observation(9, [paragraph(0, 9, [strong(0, 9, [text('sibling', 2, 9)])])], [provisional(path)]))
    assert.deepEqual(compare(document, fixture.source, open), retained)
    document.edit(17, 17, '*')
    compare(document, '**outside *inside*', observation(18, [paragraph(0, 18, [strong(0, 18, [text('outside ', 2, 10), emphasis(10, 18, [text('inside', 11, 17)])])])], [provisional(path)]))
    document.edit(18, 18, '**')
    const completed = fixtures.find(fixture => fixture.id === 'nested-completed-emphasis')
    compare(document, completed.source, completed.checkpoints.find(check => check.id === 'final-open').expected)
    assert.deepEqual(retained, saved)
    document.dispose()
    sibling.dispose()
    assert.deepEqual(retained, saved)
  } finally {
    document.dispose()
    sibling.dispose()
  }
})
