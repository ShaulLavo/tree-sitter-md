import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { heap, Language, Parser } from 'web-tree-sitter'
import { init, Kind, MarkdownDocument, memoryBytes } from '../js/index.js'

await init()

test('the host parser and both Markdown profiles initialize on the current runtime', t => {
  const parser = new Parser()
  t.after(() => parser.delete())
  parser.setLanguage(Language.loadSync(new WebAssembly.Module(
    readFileSync(new URL('../tree-sitter-markdown.wasm', import.meta.url)),
  )))
  const tree = parser.parse('# Heading\n')
  t.after(() => tree.delete())
  assert.equal(tree.rootNode.hasError, false)
  assert.equal(tree.rootNode.descendantsOfType('atx_heading').length, 1)
  for (const math of [false, true]) {
    const document = new MarkdownDocument({ math })
    t.after(() => document.dispose())
    document.setText('**bold** and [link](/target)\n')
    const children = document.semantics().root.children[0].children
    assert.equal(children[0].type, 'strong')
    assert.equal(children[0].children[0].value, 'bold')
    assert.equal(children[2].url, '/target')
  }
})

test('Wasm allocation growth preserves resolver reads, edits, and owned results', t => {
  const document = new MarkdownDocument()
  const sibling = new MarkdownDocument()
  t.after(() => { document.dispose(); sibling.dispose() })
  sibling.setText('**retained** [link](/target)\n')
  const retained = sibling.presentation({ input: 'ended' })
  const saved = JSON.stringify(retained)
  const before = heap()
  const bytes = before.byteLength
  const source = '```txt\n' + 'λ😀'.repeat(Math.ceil(bytes / 3)) + '\n```\n'
  document.setText(source)
  assert.ok(heap().byteLength > bytes, 'setText must grow the real host memory')
  assert.equal(memoryBytes(), heap().byteLength)
  assert.equal(document.presentation({ input: 'ended' }).source, source)
  assert.equal(document.semantics().root.children[0].type, 'code')
  assert.deepEqual(document.injections(0, source.length), new Uint32Array([7, source.length - 4, 3, 6]))
  assert.deepEqual(sibling.presentation({ input: 'ended' }), retained)
  if (before.buffer.resizable) assert.equal(heap(), before)
  if (!heap().buffer.resizable) assert.equal(before.byteLength, 0)
  document.setText('**after** [link](/target)\n')
  document.edit(2, 7, 'edited')
  assert.ok(document.decorations(0, 26).includes(Kind.Strong))
  assert.ok(document.highlights(0, 26).length > 0)
  assert.equal(document.semantics().root.children[0].children[0].children[0].value, 'edited')
  assert.equal(document.presentation({ input: 'ended' }).source, '**edited** [link](/target)\n')
  assert.equal(JSON.stringify(retained), saved)
  t.diagnostic(`host heap grew from ${bytes} to ${heap().byteLength} bytes`)
})
