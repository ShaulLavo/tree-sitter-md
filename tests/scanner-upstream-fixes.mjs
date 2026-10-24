// Regressions for scanner fixes ported from tree-sitter-markdown v0.5.4.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'

await init()

function root(source, options = { gfm: true }) {
  const document = new MarkdownDocument(options)
  try {
    document.setText(source)
    return document.semantics().root
  } finally { document.dispose() }
}

test('a closing fence followed by whitespace at end of input closes the code block', () => {
  for (const [source, language] of [['~~~\nx\n~~~  ', null], ['```js\nlet a\n```  ', 'js'], ['```js\nlet a\n```\t', 'js']]) {
    const { children } = root(source)
    assert.equal(children.length, 1, JSON.stringify(source))
    assert.equal(children[0].type, 'code')
    assert.equal(children[0].fence, 'closed')
    assert.equal(children[0].language, language)
    assert.equal(children[0].range.end, source.length)
  }
})

test('<!--> and <!---> are complete HTML blocks that do not swallow what follows', () => {
  for (const [open, separator] of [['<!-->', '\n\n'], ['<!--->', '\n']]) {
    const source = open + separator + '*x*\n'
    const { children } = root(source)
    assert.deepEqual(children.map(child => child.type), ['html', 'paragraph'], open)
    assert.equal(children[0].value, open)
    assert.equal(children[1].children[0].type, 'emphasis')
  }
})

test('an HTML comment block still runs to its closing marker', () => {
  const source = '<!-- a\n*not emphasis*\n-->\n\n*x*\n'
  const { children } = root(source)
  assert.deepEqual(children.map(child => child.type), ['html', 'paragraph'])
  assert.equal(children[0].value, '<!-- a\n*not emphasis*\n-->')
})
