import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { Parser, Language } from 'web-tree-sitter'
import { init, MarkdownDocument, Kind } from '../js/index.js'

const require = createRequire(import.meta.url)

test('host parsing survives concurrent Markdown initialization', async () => {
  const wasmBinary = readFileSync(require.resolve('web-tree-sitter/web-tree-sitter.wasm'))
  const grammar = new WebAssembly.Module(readFileSync(new URL('../tree-sitter-markdown.wasm', import.meta.url)))
  const hostReady = Parser.init({ wasmBinary })
  const markdownReady = init()
  await hostReady
  const parser = new Parser()
  parser.setLanguage(Language.loadSync(grammar))
  const before = parser.parse('# Hello')
  await markdownReady
  const after = parser.parse('# Hello')
  assert.equal(after.rootNode.toString(), before.rootNode.toString())
  const doc = new MarkdownDocument()
  doc.setText('**bold**')
  assert.ok(doc.decorations(0, 8).includes(Kind.Strong))
  doc.dispose()
  before.delete()
  after.delete()
  parser.delete()
})

test('init rejects the obsolete positional source argument', async () => {
  await assert.rejects(init(new Uint8Array([0])), /init expects/)
})

test('a failed resolver load can be retried with the requested bytes', async () => {
  const isolated = await import('../js/index.js?retry')
  await assert.rejects(isolated.init({ resolver: new Uint8Array([0]) }), WebAssembly.CompileError)
  const resolver = readFileSync(new URL('../tree-sitter-md.wasm', import.meta.url))
  await isolated.init({ resolver })
  const doc = new isolated.MarkdownDocument()
  doc.setText('**bold**')
  assert.ok(doc.decorations(0, 8).includes(Kind.Strong))
  doc.dispose()
})
