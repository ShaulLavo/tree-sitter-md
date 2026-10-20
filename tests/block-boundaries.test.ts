import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import { Language, Parser } from 'web-tree-sitter'
import type { SemanticBlock, SemanticInline, SemanticRoot, SemanticTableRow, SemanticTableCell, SemanticListItem, PresentationRoot, PresentationBlock, PresentationInline, PresentationTableRow, PresentationTableCell, PresentationListItem } from '../js/semantic.js'

await init()

type Point = { line: number; column: number; offset: number }
type Expected = { type: string; tagName?: string; value?: string; position?: { start: Point; end: Point };
  properties?: { dataSourceLine?: number; dataSourceEndLine?: number }; children?: readonly Expected[] }
type Fixture = { id: string; kind: 'list' | 'paragraph' | 'quote' | 'table'; source: string;
  sourceIdentity: { utf16Units: number; utf16LeSha256: string }; expected: Expected }
type Block = SemanticBlock | PresentationBlock
type Root = SemanticRoot | PresentationRoot
type Node = Root | Block | SemanticInline | SemanticTableRow | SemanticTableCell | SemanticListItem
  | PresentationInline | PresentationTableRow | PresentationTableCell | PresentationListItem
const cases: readonly Fixture[] = JSON.parse(readFileSync(new URL('./fixtures/block-boundaries.json', import.meta.url), 'utf8'))

function point(source: string, offset: number): Point {
  let line = 1, start = 0
  for (let at = 0; at < offset; at++) {
    if (source[at] !== '\r' && source[at] !== '\n') continue
    if (source[at] === '\r' && source[at + 1] === '\n') at++
    line++; start = at + 1
  }
  return { line, column: offset - start + 1, offset }
}

function checkRange(source: string, node: Node, expected: Expected): void {
  assert.ok(expected.position)
  const { start, end } = expected.position
  assert.deepEqual(node.range, { start: start.offset, end: end.offset })
  assert.deepEqual(point(source, start.offset), start)
  assert.deepEqual(point(source, end.offset), end)
  if (expected.properties?.dataSourceLine !== undefined) assert.equal(expected.properties.dataSourceLine, start.line)
  if (expected.properties?.dataSourceEndLine !== undefined) assert.equal(expected.properties.dataSourceEndLine, end.line)
}

function find(node: Expected, tag: string): Expected | undefined {
  if (node.tagName === tag) return node
  for (const child of node.children ?? []) {
    const result = find(child, tag)
    if (result) return result
  }
}

function inlineSource(source: string, node: SemanticInline | PresentationInline): string {
  if (node.type === 'break') return source.slice(node.range.start, node.range.end)
  if ('value' in node) return node.value
  return ''
}

function cellValue(cell: SemanticTableCell): string {
  return cell.children.map(node => 'value' in node ? node.value : '').join('')
}

function checkList(source: string, block: Block, expected: Expected): void {
  assert.equal(block.type, 'list')
  if (block.type !== 'list') return
  assert.equal(block.ordered, false)
  assert.equal(block.spread, false)
  assert.equal(block.items.length, 1)
  const item = block.items[0], expectedItem = find(expected, 'li')
  assert.ok(expectedItem)
  checkRange(source, item, expectedItem)
  assert.equal(item.spread, false)
  assert.equal(item.children.length, 1)
  const paragraph = item.children[0], literal = expectedItem.children?.[0]
  assert.ok(literal?.type === 'text' && literal.position)
  assert.equal(paragraph.type, 'paragraph')
  if (paragraph.type !== 'paragraph') return
  checkRange(source, paragraph, literal)
  const actual = paragraph.children.map(node => inlineSource(source, node)).join('')
  assert.equal(actual, literal.value)
  assert.ok(paragraph.children.every(node => node.type === 'text' || node.type === 'break'))
}

function checkTable(source: string, block: Block, expected: Expected): void {
  assert.equal(block.type, 'table')
  if (block.type !== 'table') return
  const row = find(expected, 'tr')
  assert.ok(row)
  checkRange(source, block.rows[0], row)
  const cells = row.children?.filter(node => node.tagName === 'th') ?? []
  assert.equal(block.rows[0].cells.length, cells.length)
  for (const [index, cell] of cells.entries()) {
    const actual: SemanticTableCell | PresentationTableCell = block.rows[0].cells[index]
    checkRange(source, actual, cell)
    assert.equal(actual.children.length, 1)
    const literal = cell.children?.[0]
    assert.ok(literal)
    checkRange(source, actual.children[0], literal)
    assert.equal('value' in actual.children[0] ? actual.children[0].value : undefined, literal.value)
  }
}

const rawTablePositions: ReadonlyMap<string, { start: Point; end: Point }> = new Map([
  ['187/54/live', { start: { line: 2, column: 2, offset: 26 }, end: { line: 6, column: 7, offset: 94 } }],
  ['187/55/live', { start: { line: 2, column: 2, offset: 26 }, end: { line: 7, column: 7, offset: 107 } }],
])

function rawExpected(row: Fixture): Expected {
  const position = rawTablePositions.get(row.id)
  return position ? { ...row.expected, position } : row.expected
}

function checkFixture(row: Fixture, root: Root): void {
  assert.ok(row.expected.position)
  const block = root.children.find(node => node.type === row.kind && node.range.start === row.expected.position?.start.offset)
  assert.ok(block, row.id)
  checkRange(row.source, block, rawExpected(row))
  if (row.kind === 'list') checkList(row.source, block, row.expected)
  if (row.kind === 'table') checkTable(row.source, block, row.expected)
  if (block.type === 'quote') assert.deepEqual(block.children, [])
  if (block.type === 'paragraph') {
    assert.deepEqual(block.children.map(node => node.type), ['text', 'break', 'text'])
    const literal = row.expected.children?.[0]
    assert.ok(literal?.position)
    assert.equal(block.children.map(node => inlineSource(row.source, node)).join(''), literal.value)
    assert.equal(block.children[0].range.start, literal.position.start.offset)
    assert.equal(block.children[2].range.end, literal.position.end.offset)
  }
}

function state(document: MarkdownDocument, source: string) {
  const { revision: _revision, ...exact } = document.semantics()
  const { revision: _openRevision, ...open } = document.presentation({ input: 'open' })
  const { revision: _endedRevision, ...ended } = document.presentation({ input: 'ended' })
  assert.equal(open.source, source)
  assert.equal(ended.source, source)
  return { exact, open, ended, decorations: Array.from(document.decorations(0, source.length)),
    highlights: Array.from(document.highlights(0, source.length)), folds: Array.from(document.folds(0, source.length)),
    injections: Array.from(document.injections(0, source.length)) }
}

function checkSaved(row: Fixture, math: boolean): void {
  const document = new MarkdownDocument({ gfm: true, cjk: true, math })
  const fresh = new MarkdownDocument({ gfm: true, cjk: true, math })
  try {
    document.setText(row.source)
    const initial = state(document, row.source)
    for (const root of [initial.exact.root, initial.open.root, initial.ended.root]) checkFixture(row, root)
    assert.ok(row.expected.position)
    const at = row.expected.position.start.offset
    document.edit(at, at, 'x')
    const changed = row.source.slice(0, at) + 'x' + row.source.slice(at)
    fresh.setText(changed)
    assert.deepEqual(state(document, changed), state(fresh, changed))
    document.edit(at, at + 1, '')
    assert.deepEqual(state(document, row.source), initial)
    document.reparse()
    assert.deepEqual(state(document, row.source), initial)
  } finally { document.dispose(); fresh.dispose() }
}

for (const row of cases) test('saved block ownership target ' + row.id, () => {
  assert.equal(row.source.length, row.sourceIdentity.utf16Units)
  assert.equal(createHash('sha256').update(Buffer.from(row.source, 'utf16le')).digest('hex'), row.sourceIdentity.utf16LeSha256)
  for (const math of [false, true]) checkSaved(row, math)
})

function checkControl(source: string, expected: readonly string[], math: boolean): void {
  const document = new MarkdownDocument({ gfm: true, cjk: true, math })
  try {
    document.setText(source)
    assert.deepEqual(document.semantics().root.children.map(node => node.type), expected)
  } finally { document.dispose() }
}

for (const eol of ['\n', '\r\n', '\r']) test('nested marker and thematic controls ' + JSON.stringify(eol), () => {
  for (const math of [false, true]) {
    checkControl(['* * *', '- - -', ''].join(eol), ['thematicBreak', 'thematicBreak'], math)
    checkControl(['- - x', '  - y', ''].join(eol), ['list'], math)
  }
})

function blockKinds(node: Root | Block | SemanticListItem | PresentationListItem): string[] {
  const kinds: string[] = [node.type]
  if (node.type === 'list') return kinds.concat(node.items.flatMap(blockKinds))
  if (node.type === 'root' || node.type === 'quote' || node.type === 'listItem')
    return kinds.concat(node.children.flatMap(blockKinds))
  return kinds
}

const emptyNested = ['root', 'list', 'listItem', 'list', 'listItem']
const literalMarker = ['root', 'paragraph', 'list', 'listItem', 'paragraph']
const markerContexts = [
  { source: '- -', kinds: emptyNested, lists: 2 },
  { source: '- - x\n', kinds: emptyNested.concat(['paragraph']), lists: 2 },
  { source: '* * x\n', kinds: emptyNested.concat(['paragraph']), lists: 2 },
  { source: '-\n  -\n', kinds: emptyNested, lists: 2 },
  { source: '- -\n', kinds: emptyNested, lists: 2 },
  { source: '- -\n  x', kinds: emptyNested.concat(['paragraph']), lists: 2 },
  { source: '- -\n\nx', kinds: emptyNested.concat(['paragraph']), lists: 2 },
  { source: 'a\n- -', kinds: literalMarker, lists: 1 },
  { source: 'a\n\n- -', kinds: ['root', 'paragraph'].concat(emptyNested.slice(1)), lists: 2 },
  { source: '+ +', kinds: emptyNested, lists: 2 },
  { source: '1. 2.', kinds: emptyNested, lists: 2 },
  { source: '- -\n    -', kinds: emptyNested.concat(['list', 'listItem']), lists: 3 },
  { source: '> - -', kinds: ['root', 'quote'].concat(emptyNested.slice(1)), lists: 2 },
  { source: '-\t-', kinds: emptyNested, lists: 2 },
  { source: '- +', kinds: emptyNested, lists: 2 },
  { source: '* *\n  text', kinds: emptyNested.concat(['paragraph']), lists: 2 },
  { source: 'a\n+ +', kinds: literalMarker, lists: 1 },
  { source: 'a\n1. 2.', kinds: literalMarker, lists: 1 },
]

function checkMarkerContext(source: string, kinds: readonly string[], math: boolean): void {
  const document = new MarkdownDocument({ gfm: true, cjk: true, math })
  const fresh = new MarkdownDocument({ gfm: true, cjk: true, math })
  try {
    document.setText(source)
    const initial = state(document, source)
    assert.deepEqual(blockKinds(initial.exact.root), kinds)
    assert.deepEqual(initial.ended.root, initial.exact.root)
    document.edit(0, 0, 'a\n\n')
    fresh.setText('a\n\n' + source)
    assert.deepEqual(state(document, 'a\n\n' + source), state(fresh, 'a\n\n' + source))
    document.edit(0, 3, '')
    assert.deepEqual(state(document, source), initial)
    document.reparse()
    assert.deepEqual(state(document, source), initial)
  } finally { document.dispose(); fresh.dispose() }
}

for (const row of markerContexts) test('empty nested marker paragraph context ' + JSON.stringify(row.source), () => {
  for (const eol of ['\n', '\r\n', '\r']) {
    const source = row.source.replaceAll('\n', eol)
    for (const math of [false, true]) checkMarkerContext(source, row.kinds, math)
  }
})

function checkInterruptionEdit(markers: string, eol: string, math: boolean): void {
  const source = 'a' + eol + markers
  const at = 1 + eol.length
  const changed = source.slice(0, at) + eol + source.slice(at)
  const document = new MarkdownDocument({ gfm: true, math })
  const fresh = new MarkdownDocument({ gfm: true, math })
  try {
    document.setText(source)
    const initial = state(document, source)
    assert.deepEqual(blockKinds(initial.exact.root), literalMarker)
    document.edit(at, at, eol)
    fresh.setText(changed)
    assert.deepEqual(state(document, changed), state(fresh, changed))
    assert.deepEqual(blockKinds(document.semantics().root), ['root', 'paragraph'].concat(emptyNested.slice(1)))
    document.edit(at, at + eol.length, '')
    assert.deepEqual(state(document, source), initial)
    document.reparse()
    assert.deepEqual(state(document, source), initial)
  } finally { document.dispose(); fresh.dispose() }
}

for (const markers of ['- -', '* *', '+ +', '1. 2.']) test('blank-line edits change empty nested marker context ' + markers, () => {
  for (const eol of ['\n', '\r\n', '\r']) {
    for (const math of [false, true]) checkInterruptionEdit(markers, eol, math)
  }
})

function checkPrefixes(source: string, math: boolean): void {
  const document = new MarkdownDocument({ gfm: true, cjk: true, math })
  const fresh = new MarkdownDocument({ gfm: true, cjk: true, math })
  let current = ''
  try {
    for (const unit of source.split('')) {
      document.edit(current.length, current.length, unit)
      current += unit
      fresh.setText(current)
      assert.deepEqual(state(document, current), state(fresh, current), JSON.stringify(current))
      document.reparse()
      assert.deepEqual(state(document, current), state(fresh, current))
    }
  } finally { document.dispose(); fresh.dispose() }
}

for (const math of [false, true]) test('original UTF-16 prefixes and scanner state ' + math, () => {
  const sources = cases.filter(row => row.id === '205/64/completed' || row.id === '236/60/live').map(row => row.source)
  for (const source of sources) checkPrefixes(source, math)
})

function checkTablePadding(source: string): void {
  const document = new MarkdownDocument()
  try {
    document.setText(source)
    const table = document.semantics().root.children[0]
    assert.ok(table?.type === 'table')
    assert.deepEqual(table.align, ['left', 'right'])
    assert.equal(table.rows[0].cells.length, 2)
    assert.deepEqual(table.rows[0].cells.map(cellValue), ['a|x', 'b'])
    assert.deepEqual(table.rows[0].cells.map(cell => cell.range), [{ start: 0, end: 7 }, { start: 7, end: 15 }])
    assert.deepEqual(table.rows[1].cells[1], { type: 'tableCell', range: null, children: [] })
  } finally { document.dispose() }
}

for (const eol of ['\n', '\r\n', '\r']) test('cell ownership preserves escaped pipes, alignment and padding ' + JSON.stringify(eol), () => {
  checkTablePadding(`| a\\|x | b |   ${eol}|:---|---:|${eol}| c |`)
})

const languages = await Promise.all(['../tree-sitter-markdown.wasm', '../tree-sitter-markdown-chat.wasm'].map(path =>
  Language.load(readFileSync(new URL(path, import.meta.url)))))

function checkMarkerCst(source: string, lists: number): void {
  for (const language of languages) {
    const parser = new Parser()
    parser.setLanguage(language)
    const tree = parser.parse(source)
    assert.ok(tree)
    try {
      assert.equal(tree.rootNode.hasError, false)
      assert.equal(tree.rootNode.descendantsOfType('list').length, lists)
    } finally { tree.delete(); parser.delete() }
  }
}

for (const row of markerContexts) test('empty nested marker CST context ' + JSON.stringify(row.source), () => {
  for (const eol of ['\n', '\r\n', '\r']) checkMarkerCst(row.source.replaceAll('\n', eol), row.lists)
})

for (const row of cases.filter(row => row.kind === 'list')) test('saved empty marker CST ' + row.id, () => {
  for (const language of languages) {
    const parser = new Parser()
    parser.setLanguage(language)
    const tree = parser.parse(row.source)
    assert.ok(tree)
    try {
      assert.equal(tree.rootNode.hasError, false)
      assert.equal(tree.rootNode.descendantsOfType('list').length, row.id.startsWith('205/') ? 1 : 2)
    } finally { tree.delete(); parser.delete() }
  }
})

function checkDefinitionRoot(root: Root, source: string): void {
  assert.deepEqual(root.children.map(node => node.type), ['list', 'quote', 'paragraph'])
  const quote = root.children[1]
  assert.ok(quote?.type === 'quote')
  assert.deepEqual(quote.range, { start: source.indexOf('>\tcode'), end: source.indexOf('code') + 4 })
  const paragraph = quote.children[0]
  assert.ok(paragraph?.type === 'paragraph')
  assert.equal(paragraph.children.map(node => inlineSource(source, node)).join(''), 'code')
}

function checkDefinitionClosure(source: string, math: boolean, gfm: boolean): void {
  const document = new MarkdownDocument({ math, gfm })
  const fresh = new MarkdownDocument({ math, gfm })
  try {
    document.setText(source)
    const initial = state(document, source)
    for (const root of [initial.exact.root, initial.open.root, initial.ended.root]) checkDefinitionRoot(root, source)
    const at = source.indexOf('  >\tcode')
    document.edit(at, at, ' ')
    const changed = source.slice(0, at) + ' ' + source.slice(at)
    fresh.setText(changed)
    assert.deepEqual(state(document, changed), state(fresh, changed))
    document.edit(at, at + 1, '')
    assert.deepEqual(state(document, source), initial)
    document.reparse()
    assert.deepEqual(state(document, source), initial)
  } finally { document.dispose(); fresh.dispose() }
}

for (const marker of ['1. > ', '10. > ', '1. - > ', '  - > ']) test('definition closes unmatched list before quote ' + marker, () => {
  for (const eol of ['\n', '\r\n', '\r']) {
    const source = marker + '[x]: /target' + eol + '  >\tcode' + eol + eol + '[x]'
    for (const math of [false, true]) checkDefinitionClosure(source, math, false)
    for (const math of [false, true]) checkDefinitionClosure(source, math, true)
  }
})

function checkWideRow(source: string, row: SemanticTableRow, values: readonly string[]): void {
  assert.equal(row.cells.length, values.length)
  let owner = row.range.start
  for (const [index, cell] of row.cells.entries()) {
    const literal = cell.children[0]
    assert.ok(literal?.type === 'text' && cell.range)
    assert.equal(literal.value, values[index])
    assert.equal(source.slice(literal.range.start, literal.range.end), values[index])
    assert.equal(cell.range.start, owner)
    const nextPipe = source.indexOf('|', owner + 1)
    assert.equal(cell.range.end, index + 1 === values.length ? row.range.end : nextPipe)
    owner = cell.range.end
  }
}

test('wide table ownership keeps every inline source slice separate', () => {
  const document = new MarkdownDocument()
  const headers = Array.from({ length: 300 }, (_, index) => 'h' + index)
  const values = Array.from({ length: 300 }, (_, index) => 'v' + index)
  const source = '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n| ' + values.join(' | ') + ' |'
  try {
    document.setText(source)
    const table = document.semantics().root.children[0]
    assert.ok(table?.type === 'table')
    checkWideRow(source, table.rows[0], headers)
    checkWideRow(source, table.rows[1], values)
  } finally { document.dispose() }
})

function cellRanges(row: SemanticTableRow) {
  return row.cells.map(cell => cell.range)
}

test('table classification edits keep ownership and undo to the original paragraph', () => {
  const document = new MarkdownDocument()
  const fresh = new MarkdownDocument()
  const source = '| a | b |\n| --'
  const suffix = '- | --- |\n| c | d |'
  try {
    document.setText(source)
    const initial = state(document, source)
    document.edit(source.length, source.length, suffix)
    fresh.setText(source + suffix)
    assert.deepEqual(state(document, source + suffix), state(fresh, source + suffix))
    const table = document.semantics().root.children[0]
    assert.ok(table?.type === 'table')
    assert.deepEqual(table.rows.map(cellRanges), [
      [{ start: 0, end: 4 }, { start: 4, end: 9 }], [{ start: 24, end: 28 }, { start: 28, end: 33 }],
    ])
    document.edit(source.length, source.length + suffix.length, '')
    assert.deepEqual(state(document, source), initial)
    document.reparse()
    assert.deepEqual(state(document, source), initial)
  } finally { document.dispose(); fresh.dispose() }
})

for (const [id, nativeEnd, preparedEnd] of [['187/54/live', 94, 93], ['187/55/live', 107, 106]] satisfies readonly [string, number, number][]) {
  test('raw live table end remains separate from saved prepared HAST ' + id, () => {
    const row = cases.find(row => row.id === id)
    assert.ok(row?.expected.position)
    assert.equal(row.expected.position.end.offset, preparedEnd)
    assert.equal(row.source.length, nativeEnd)
    assert.equal(row.source.at(-1), '`')
    assert.equal(rawExpected(row).position?.end.offset, nativeEnd)
  })
}

function rejectShiftedTableEnd(row: Fixture): void {
  const document = new MarkdownDocument()
  try {
    document.setText(row.source)
    const root = document.semantics().root
    const children = root.children.map(block => block.type === 'table'
      ? { ...block, range: { start: block.range.start, end: block.range.end - 1 } } : block)
    assert.throws(() => checkFixture(row, { ...root, children }))
  } finally { document.dispose() }
}

for (const row of cases.filter(row => row.kind === 'table'))
  test('table ownership rejects shifted final offsets ' + row.id, () => rejectShiftedTableEnd(row))
