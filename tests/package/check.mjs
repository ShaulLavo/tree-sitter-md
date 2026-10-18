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
  first.setText('**outside *inside')
  const streaming = first.presentation({ input: 'open' })
  const strong = streaming.root.children[0].children[0]
  equal(strong.type, 'strong', 'Packed presentation lost provisional strong')
  equal(strong.children[1].type, 'emphasis', 'Packed presentation lost nested provisional emphasis')
  equal(strong.children[1].children[0].value, 'inside', 'Packed presentation lost provisional content')
  equal(streaming.provisional.length, 2, 'Packed presentation lost provisional metadata')
  const ended = first.presentation({ input: 'ended' })
  equal(ended.revision, streaming.revision, 'Packed mode change advanced source revision')
  equal(ended.root, first.semantics().root, 'Packed ended presentation differs from exact semantics')
  equal(ended.provisional, [], 'Packed ended presentation retained provisional metadata')
  const retainedStreaming = JSON.stringify(streaming)
  first.setText('[label](https://exa')
  const pending = first.presentation({ input: 'open' }).root.children[0].children[0]
  equal(pending.type, 'pendingLink', 'Packed presentation lost pending link')
  if ('url' in pending || 'title' in pending) throw new Error('Packed pending link invented a destination')
  first.setText('[late][id]\n\n- [ ]')
  const dependencies = first.presentation({ input: 'open' })
  const retainedDependencies = JSON.stringify(dependencies)
  equal(dependencies.root.children.length, 1, 'Packed empty trailing list was emitted')
  equal(dependencies.suppressed, [{ range: { start: 12, end: 17 }, reason: 'empty-trailing-marker' }], 'Packed block suppression lost its source range')
  equal(dependencies.references, [{ kind: 'link', identifier: 'id', range: { start: 0, end: 10 }, resolution: 'unresolved' }], 'Packed unresolved reference reporting changed')
  first.edit(17, 17, '\n\n[id]: /target')
  const resolved = first.presentation({ input: 'ended' })
  equal(resolved.root.children[0].children[0].url, '/target', 'Packed late reference stayed unresolved')
  equal(resolved.references[0].resolution, 'resolved', 'Packed late reference metadata stayed unresolved')
  equal(resolved.root, first.semantics().root, 'Packed block/reference ended output changed exact semantics')
  equal(JSON.stringify(dependencies), retainedDependencies, 'Packed reference snapshot changed after an edit')
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
  equal(JSON.stringify(streaming), retainedStreaming, 'Packed provisional snapshot changed after edits/disposal')
  equal(JSON.stringify(dependencies), retainedDependencies, 'Packed reference snapshot changed after disposal')
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
