import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'
import type { SemanticBlock } from '../js/semantic.js'

await init()

function blocks(source: string): readonly SemanticBlock[] {
  const document = new MarkdownDocument({ gfm: true, cjk: true, math: true })
  try {
    document.setText(source)
    return document.semantics().root.children
  } finally { document.dispose() }
}

// The `* *` line's outer item holds either a nested empty list or the literal `*`.
function listAt(candidates: readonly SemanticBlock[], at: number): SemanticBlock | undefined {
  for (const block of candidates) {
    if (block.type === 'list' && block.range.start === at) return block
    const inner = block.type === 'list' ? block.items.flatMap(item => item.children)
      : block.type === 'quote' ? block.children : []
    const found = listAt(inner, at)
    if (found) return found
  }
}

function starItem(source: string, line = '* *'): string {
  const at = source.lastIndexOf(line)
  const list = listAt(blocks(source), at)
  if (list?.type !== 'list') throw new TypeError('expected a list at ' + at)
  const [child] = list.items[0].children
  if (child?.type === 'list') return child.items[0].children.length ? 'nested item with content' : 'nested empty item'
  if (child?.type === 'paragraph') return 'literal'
  return String(child?.type)
}

// An empty marker may not start inside a list that interrupts a paragraph, unless the
// line closes that paragraph's container first (micromark closes its flow).
const cases = [
  ['* *\n', 'nested empty item'],
  ['a\n* *\n', 'literal'],
  ['- a\n  * *\n', 'literal'],
  ['- a\nb\n* *\n', 'nested empty item'],
  ['- a\n* *\n', 'nested empty item'],
  ['> a\n* *\n', 'nested empty item'],
  ['- a\r\nb\r\n* *\r\n', 'nested empty item'],
  ['> a\n> * *\n', 'literal'],
] as const
for (const [source, expected] of cases) test('empty nested marker after ' + JSON.stringify(source), () => {
  assert.equal(starItem(source), expected)
})

test('a different outer marker after a closed item still nests the empty item', () => {
  assert.equal(starItem('- a\n+ *\n', '+ *'), 'nested empty item')
})

const saved = [
  { id: '236/completed/54', units: 128, expected: 'nested empty item',
    sha256: '2de98a4f63086048b00c587361caea091f3c967898d54e2f1c09af8e4b495ce9',
    source: "A&am[x]p; *- \r\n*s(h> tt🧑‍\ud83d\r\n\udcbbps://exampl(https://example.test/a)e.test_/a)\n\nt/a)tps:/\r\n- /ex\r\nst/a> )d\narge**t\n* *\n\nmessag`e.\n\n" },
  { id: '236/completed/60', units: 112, expected: 'literal',
    sha256: '559c9391e947ed880ee0f67aef023828670e13527434f7cc8ed70767bc2c2751',
    source: "A&am[x]p; *- \r\n*s(h> tt🧑‍\ud83d\r\n\udcbbps:/(https://example.test/a)e.\nt/a)tps:/\r\n- /ex\r\nst/a)d\n\r\narge**t\n* *\n\nmessag`e.\n\n" },
]
for (const item of saved) test('saved fuzz witness ' + item.id, () => {
  assert.equal(item.source.length, item.units)
  assert.equal(createHash('sha256').update(Buffer.from(item.source, 'utf16le')).digest('hex'), item.sha256)
  assert.equal(starItem(item.source), item.expected)
})
