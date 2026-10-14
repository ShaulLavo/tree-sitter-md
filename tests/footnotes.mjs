import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'

await init()

function snapshot(source, options) {
  const document = new MarkdownDocument(options)
  try {
    document.setText(source)
    return document.semantics()
  } finally {
    document.dispose()
  }
}

function descendants(node, type) {
  const children = node.children ?? node.items ?? node.rows ?? node.cells ?? []
  return (node.type === type ? [node] : []).concat(children.flatMap((child) => descendants(child, type)))
}

test('footnotes resolve normalized labels defined later and retain exact source spans', () => {
  const source = 'Read [^Mixed].\n\n[^mixed]: A **small** note.'
  const result = snapshot(source)
  assert.equal(result.capabilities.footnotes, true)
  const references = descendants(result.root, 'footnoteReference')
  assert.equal(references.length, 1)
  assert.equal(references[0].identifier, 'mixed')
  assert.equal(source.slice(references[0].range.start, references[0].range.end), '[^Mixed]')
  const definitions = descendants(result.root, 'footnoteDefinition')
  assert.equal(definitions.length, 1)
  assert.equal(definitions[0].identifier, 'mixed')
  assert.deepEqual(definitions[0].children.map((node) => node.type), ['paragraph'])
  const strong = descendants(definitions[0], 'strong')[0]
  assert.equal(strong.children[0].value, 'small')
  assert.equal(source.slice(strong.range.start, strong.range.end), '**small**')
})

test('duplicate definitions stay in source order while references use the first identifier', () => {
  const result = snapshot('[^A]\n\n[^a]: First.\n\n[^A]: Second.')
  const definitions = descendants(result.root, 'footnoteDefinition')
  assert.equal(definitions.length, 2)
  assert.deepEqual(definitions.map((node) => node.identifier), ['a', 'a'])
  assert.deepEqual(definitions.map((node) => descendants(node, 'text')[0].value), ['First.', 'Second.'])
  assert.equal(descendants(result.root, 'footnoteReference')[0].identifier, 'a')
})

test('mapped footnote bodies retain multiple paragraphs, nested lists and outer content', () => {
  const source = '[^a]: First.\n\n    - one\n    - two\n\n    Last.\n\nAfter [^a].'
  const result = snapshot(source)
  const definition = descendants(result.root, 'footnoteDefinition')[0]
  assert.deepEqual(definition.children.map((node) => node.type), ['paragraph', 'list', 'paragraph'])
  assert.deepEqual(definition.children[1].items.map((node) => descendants(node, 'text')[0].value), ['one', 'two'])
  assert.equal(source.slice(definition.children[1].range.start, definition.children[1].range.start + 5), '- one')
  assert.equal(descendants(result.root, 'footnoteReference').length, 1)
  assert.equal(result.root.children.at(-1).children[0].value, 'After ')
})

test('lazy continuation stays in the footnote, while a completed heading ends laziness', () => {
  const lazy = snapshot('[^a]: First.\ncontinued\n\nAfter.').root
  assert.equal(descendants(lazy, 'footnoteDefinition')[0].children[0].children[0].value, 'First.\ncontinued')
  const heading = snapshot('[^a]: First\n    ---\nAfter.').root
  assert.equal(descendants(heading, 'footnoteDefinition')[0].children[0].type, 'heading')
  assert.equal(heading.children.at(-1).children[0].value, 'After.')
})

test('escaped references, inline code and fenced definitions do not become footnotes', () => {
  const source = '\\[^a] and `[^a]` and [^unknown].\n\n[^a]: Known.\n\n```\n[^b]: Code.\n```'
  const result = snapshot(source).root
  assert.equal(descendants(result, 'footnoteReference').length, 0)
  assert.equal(descendants(result, 'footnoteDefinition').length, 1)
  assert.equal(descendants(result, 'code').some((node) => node.value.includes('[^b]')), true)
})

test('footnote bodies resolve ordinary document links and Unicode label identities', () => {
  const source = '[^Ä]\n\n[^ä]: 😀 [guide][doc].\n\n[doc]: /docs "Guide"'
  const result = snapshot(source).root
  const reference = descendants(result, 'footnoteReference')[0]
  const definition = descendants(result, 'footnoteDefinition')[0]
  assert.equal(reference.identifier, definition.identifier)
  assert.equal(source.slice(reference.range.start, reference.range.end), '[^Ä]')
  const link = descendants(definition, 'link')[0]
  assert.equal(link.url, '/docs')
  assert.equal(link.title, 'Guide')
  assert.equal(source.slice(link.range.start, link.range.end), '[guide][doc]')
})

test('late definitions and removals refresh earlier references without mutating retained snapshots', () => {
  const document = new MarkdownDocument()
  try {
    document.setText('Read [^a].')
    assert.equal(descendants(document.semantics().root, 'footnoteReference').length, 0)
    document.edit(10, 10, '\n\n[^a]: Late.')
    const before = document.semantics()
    const frozen = JSON.stringify(before)
    assert.equal(descendants(before.root, 'footnoteReference').length, 1)
    document.edit(10, document.semantics().root.range.end, '')
    assert.equal(descendants(document.semantics().root, 'footnoteReference').length, 0)
    assert.equal(JSON.stringify(before), frozen)
  } finally {
    document.dispose()
  }
})

test('ordinary CommonMark mode keeps caret labels as link definitions', () => {
  const result = snapshot('[^a]\n\n[^a]: /url', { gfm: false })
  assert.equal(result.capabilities.footnotes, false)
  assert.equal(descendants(result.root, 'footnoteReference').length, 0)
  assert.equal(descendants(result.root, 'footnoteDefinition').length, 0)
  assert.equal(descendants(result.root, 'link')[0].url, '/url')
})
