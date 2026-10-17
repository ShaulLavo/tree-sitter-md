import { Parser, Language } from 'web-tree-sitter'
import { init, MarkdownDocument, Kind } from 'tree-sitter-md'

function equal(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message)
}

function snapshot(document, length) {
  return {
    decorations: [...document.decorations(0, length)],
    highlights: [...document.highlights(0, length)],
    folds: [...document.folds()],
    injections: [...document.injections()],
    semantics: document.semantics(),
    presentation: document.presentation({ input: 'ended' }),
  }
}

export async function check(order, options = {}, hostOptions = {}) {
  if (order === 'host-first') {
    await Parser.init(hostOptions)
    await init({ ...options, grammar: await loadHostGrammar(options) })
  }
  if (order === 'concurrent') await Promise.all([Parser.init(hostOptions), init(options), init(options)])
  await init(options)
  await init(options)
  await Parser.init(hostOptions)
  const source = '# Title\n\n**strong** and [link](/target)\n\n```js\nlet x = 1\n```\n'
  const first = new MarkdownDocument()
  const sibling = new MarkdownDocument()
  const received = 'received\0\uD83D\r\n'
  first.edit(0, 0, received)
  const retained = first.presentation({ input: 'open' })
  equal(retained.source, received, 'Packed presentation lost received UTF-16 source')
  equal(retained.input, 'open', 'Packed presentation lost requested input mode')
  equal(retained.root, first.semantics().root, 'P1 presentation changed exact semantics')
  const retainedText = JSON.stringify(retained)
  first.setText(source)
  sibling.setText(source)
  const before = snapshot(sibling, source.length)
  await init(options)
  equal(snapshot(sibling, source.length), before, 'Repeated init changed a live document')
  const kinds = before.decorations.filter((_, index) => index % 4 === 2)
  const paragraph = before.semantics.root.children[1]
  equal(paragraph.children[0].children[0].value, 'strong', 'Semantic inline values were not decoded')
  equal(paragraph.children[2].url, '/target', 'Semantic destination was not resolved')
  if (!kinds.includes(Kind.Strong) || !kinds.includes(Kind.Link)) throw new Error('Inline resolver did not run')
  first.edit(source.indexOf('strong'), source.indexOf('strong') + 6, 'changed')
  equal(snapshot(sibling, source.length), before, 'Sibling document changed after edit')
  first.dispose()
  equal(JSON.stringify(retained), retainedText, 'Packed presentation changed after edits/disposal')
  equal(snapshot(sibling, source.length), before, 'Sibling document changed after disposal')
  const language = await loadHostGrammar(options)
  const parser = new Parser()
  parser.setLanguage(language)
  const tree = parser.parse(source)
  if (!tree.rootNode.toString().includes('atx_heading')) throw new Error('Host grammar parsing failed after resolver init')
  tree.delete()
  parser.delete()
  sibling.dispose()
  equal(before.semantics.root.children[0].children[0].value, 'Title', 'Owned semantic values changed after disposal')
  return { order, records: before.decorations.length / 4 }
}

function loadHostGrammar(options) {
  const grammar = options.grammar ?? new URL('./node_modules/tree-sitter-md/tree-sitter-markdown.wasm', import.meta.url)
  return Language.load(grammar instanceof URL ? grammar.pathname : grammar)
}
