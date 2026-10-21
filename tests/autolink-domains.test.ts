import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { init, MarkdownDocument, Kind } from '../js/index.js'
import type { SemanticRoot, SemanticBlock, SemanticInline, SemanticListItem, SemanticTableRow, SemanticTableCell,
  PresentationRoot, PresentationBlock, PresentationInline, PresentationListItem, PresentationTableRow, PresentationTableCell } from '../js/semantic.js'

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

function links(node: Node): Extract<Node, { type: 'link' }>[] {
  const own = node.type === 'link' ? [node] : []
  return own.concat(children(node).flatMap(links))
}

function linkDecorationCount(document: MarkdownDocument, length: number): number {
  const decorations = document.decorations(0, length)
  let count = 0
  for (let at = 0; at < decorations.length; at += 4) {
    if (decorations[at + 2] === Kind.Link) count++
  }
  return count
}

function expectDocument(document: MarkdownDocument, source: string, expected: readonly string[]): void {
  const exact = document.semantics().root
  const open = document.presentation({ input: 'open' })
  const ended = document.presentation({ input: 'ended' })
  assert.equal(open.source, source)
  assert.equal(ended.source, source)
  for (const root of [exact, open.root, ended.root]) {
    assert.deepEqual(links(root).map(link => link.url), expected, JSON.stringify(source))
  }
  assert.equal(linkDecorationCount(document, source.length), expected.length,
    'decoration agreement: ' + JSON.stringify(source))
}

function check(source: string, expected: readonly string[], cjk = false): void {
  const document = new MarkdownDocument({ gfm: true, cjk })
  try {
    document.setText(source)
    expectDocument(document, source, expected)
  } finally { document.dispose() }
}


// Literal HTTP(S) hosts may be dotless. Final-label underscore checks still apply.
// CommonMark angle autolinks and explicit links have their own rules.
for (const source of ['https://foo_bar.test/a', 'https://foo.bar_baz/a', 'https://foo._bar.test/a',
  'https://éxam_ple.test/a', 'https://ex🧑‍💻am_ple.test/a', 'https://foo.test_/',
  'www.éxam_ple.test/a', 'www.foo.bar_baz/a']) {
  test('invalid extended domain: ' + source, () => check(source, []))
}

const valid = [
  ['http://a', 'http://a'],
  ['https://examarget', 'https://examarget'],
  ['https://examarget:8080/a.b', 'https://examarget:8080/a.b'],
  ['https://examarget/a.b', 'https://examarget/a.b'],
  ['https://examarget?x=a.b', 'https://examarget?x=a.b'],
  ['https://examarget#x.y', 'https://examarget#x.y'],
  ['https://examarget.', 'https://examarget'],
  ['https://examarget_?!', 'https://examarget'],
  ['http://a.b', 'http://a.b'],
  ['https://example.test', 'https://example.test'],
  ['HTTPS://EXAMPLE.TEST:8080/a_b?q=x.y#z', 'HTTPS://EXAMPLE.TEST:8080/a_b?q=x.y#z'],
  ['https://foo_bar.example.test/a', 'https://foo_bar.example.test/a'],
  ['https://éxam_ple.example.test/a', 'https://éxam_ple.example.test/a'],
  ['www.foo_bar.example.test/a', 'http://www.foo_bar.example.test/a'],
  ['https://example.test/a).', 'https://example.test/a'],
  ['https://example.test/a(b))', 'https://example.test/a(b)'],
  ['https://example.test/a?!:;*_~', 'https://example.test/a'],
  ['<https://examarget>', 'https://examarget'],
  ['<https://foo_bar.test/a>', 'https://foo_bar.test/a'],
  ['[x](https://examarget)', 'https://examarget'],
  ['[x](https://foo_bar.test/a)', 'https://foo_bar.test/a'],
  ['<localhost:5001/foo>', 'localhost:5001/foo'],
]
for (const [source, url] of valid) test('valid link control: ' + source, () => check(source, [url]))

// An unclosed bracket leaves the text to the literal fallback, which needs a dot in the authored host.
const bracketed = [
  ['[ https://example. x', ['https://example']],
  ['[ https://example.t x', ['https://example.t']],
  ['[ https://example.tes| x', ['https://example.tes|']],
  ['[ https://example x', []],
] as const
// The open presentation holds text after an unclosed bracket, so only exact and ended output apply.
function checkSettled(source: string, expected: readonly string[], cjk = false): void {
  const document = new MarkdownDocument({ gfm: true, cjk })
  try {
    document.setText(source)
    for (const root of [document.semantics().root, document.presentation({ input: 'ended' }).root]) {
      assert.deepEqual(links(root).map(link => link.url), expected, JSON.stringify(source))
    }
    assert.equal(linkDecorationCount(document, source.length), expected.length,
      'decoration agreement: ' + JSON.stringify(source))
  } finally { document.dispose() }
}
for (const [source, urls] of bracketed) test('bracketed literal host: ' + source, () => checkSettled(source, urls))

test('saved fuzz witness 210/completed/58 keeps the link before its trailing dot', () => {
  const source = "|*>\r\n * \n\na&amp;| a b &amp;|\n|----|\n---|\n |--| a | b\n.[`| a | b |\n|`---|- (https://example. |\n|---|-|\n\n"
  assert.equal(source.length, 103)
  assert.equal(createHash('sha256').update(Buffer.from(source, 'utf16le')).digest('hex'),
    '823608e2bbf9198c6dd27817a4c647044ed2137b39596e7278d11b74ed876633')
  checkSettled(source, ['https://example'])
  checkSettled(source, ['https://example'], true)
})

const saved = [
  { id: "181/completed/39", units: 58,
    sha256: "8ba08a9c8efd285760aa2b76691f25b7c2bd0295b4c01d84c7e05447370de272",
    source: "&am`p;Ax]see$x$d* \ud83e--\u05d0\u05d1\u05d2([get\n[x]https://examarget\n/a*)-|\n" },
  { id: "216/completed/20", units: 83,
    sha256: "743fe233acc2221678851b408cf6b6af59b007061f3b803d74e9d18b44c0d9be",
    source: "A **see&amp([(https://exast/a/target\nh\u05d0\u05d1\u05d2ttpample.tes\r\n*t/d** m| a | b |\n|---|---|\n" },
  { id: "196/completed/63", units: 98,
    sha256: "69929756996a5393b65e04117f407f62864d20cf2e21f00bb5ef270cf1ef2a4b",
    source: "_A *- *\n *\u05d2\u05d1&amp;\u05d0_\u05d1\u05d2_\u05d0\u05d1|* \n\u05d0\u05d1(https://ex\ud83e\uddd1\u200d\ud83d\udcbbam_ple.test/a)\u05d2\na ```\n| |\n--|-[x]: /target\n\u05d0\u05d1\u05d2\u05d0\u05d1\u05d2--|" },
  { id: "212/completed/20", units: 83,
    sha256: "15217a5ef52c90804ce2ef61783f9f6b71ef890f7b8fdaafb2af67f1a29afc2c",
    source: "A > **see$x$ded_** mes(https://e\ud83e\uddd1\ud83e\uddd1_\u200d\ud83d\udcbb\u200d\ud83d\udcbb[xxample.te\ud83e\uddd1\u200d\ud83d\udcbbst/a)s[x]: /target\nage.\n" },
]
for (const item of saved) test('saved r68 domain witness ' + item.id, () => {
  assert.equal(item.source.length, item.units)
  assert.equal(createHash('sha256').update(Buffer.from(item.source, 'utf16le')).digest('hex'), item.sha256)
  check(item.source, [], false)
  check(item.source, [], true)
})

test('an underscore edit after Unicode invalidates and restores the native link', () => {
  const document = new MarkdownDocument({ gfm: true })
  const source = 'https://ex🧑‍💻ample.test/a'
  const at = source.indexOf('ample') + 2
  const invalid = source.slice(0, at) + '_' + source.slice(at)
  try {
    document.setText(source)
    expectDocument(document, source, [source])
    document.edit(at, at, '_')
    expectDocument(document, invalid, [])
    document.edit(at, at + 1, '')
    expectDocument(document, source, [source])
  } finally { document.dispose() }
})
