import { Parser, Language, heap } from 'web-tree-sitter'
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
    open: document.presentation({ input: 'open' }),
    presentation: document.presentation({ input: 'ended' }),
  }
}

async function initialize(order, options, hostOptions) {
  const instantiate = WebAssembly.instantiate
  const memories = new Set()
  WebAssembly.instantiate = async function (...args) {
    const result = await instantiate.apply(this, args)
    const instance = result.instance ?? result
    if (instance.exports.memory) memories.add(instance.exports.memory)
    return result
  }
  try { await initializeInOrder(order, options, hostOptions) }
  finally { WebAssembly.instantiate = instantiate }
  const memory = Array.from(memories).find(value => value.toResizableBuffer() === heap().buffer)
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('Packed runtime memory was not captured')
  return memory
}

async function initializeInOrder(order, options, hostOptions) {
  if (order === 'host-first') {
    await Parser.init(hostOptions)
    await init({ ...options, grammar: await loadHostGrammar(options) })
  }
  if (order === 'concurrent') await Promise.all([Parser.init(hostOptions), init(options), init(options)])
  await init(options)
  await init(options)
  await Parser.init(hostOptions)
}

function views(document, source) {
  const exact = document.semantics()
  const open = document.presentation({ input: 'open' })
  const ended = document.presentation({ input: 'ended' })
  equal(open.source, source, 'Packed open presentation changed received source')
  equal(ended.source, source, 'Packed ended presentation changed received source')
  equal(open.input, 'open', 'Packed open input mode changed')
  equal(ended.input, 'ended', 'Packed ended input mode changed')
  equal(open.revision, exact.revision, 'Packed open read advanced revision')
  equal(ended.provisional, [], 'Packed ended output retained provisional metadata')
  equal(ended.suppressed, [], 'Packed ended output retained suppression')
  const { source: ignoredSource, input, provisional, suppressed, references, ...canonical } = ended
  equal(canonical, exact, 'Packed ended output differs from complete exact semantics')
  equal(document.semantics(), exact, 'Packed presentation changed exact semantics')
  return { exact, open, ended }
}

function withoutRevisions(results) {
  return Object.fromEntries(Object.entries(results).map(([mode, result]) => {
    const { revision, ...value } = result
    return [mode, value]
  }))
}

function checkLifecycle(memory) {
  const options = { gfm: true, cjk: true, math: true }
  const document = new MarkdownDocument(options)
  const fresh = new MarkdownDocument(options)
  const sibling = new MarkdownDocument({ gfm: false })
  const source = '**outside *inside'
  const replacement = '\uFEFFreceived\0\uFFFD\r\n\uD83D'
  const siblingSource = 'sibling **pending'
  try {
    document.setText(source)
    sibling.setText(siblingSource)
    const before = views(document, source)
    const saved = JSON.stringify(before)
    const siblingBefore = views(sibling, siblingSource)
    for (const input of ['open', 'ended', 'ended', 'open'])
      equal(document.presentation({ input }), before[input], 'Packed metadata-only transition changed its snapshot')
    document.reparse()
    equal(views(document, source), before, 'Packed idle reparse changed snapshots or revision')
    const bytes = memory.buffer.byteLength
    memory.grow(1)
    equal(memory.buffer.byteLength, bytes + 65536, 'Packed host memory did not grow by one page')
    equal(views(document, source), before, 'Packed memory growth changed live snapshots')
    document.edit(source.length, source.length, '* outside**')
    equal(document.semantics().revision, before.exact.revision + 1, 'Packed resume edit advanced revision incorrectly')
    const resumed = source + '* outside**'
    fresh.setText(resumed)
    equal(withoutRevisions(views(document, resumed)), withoutRevisions(views(fresh, resumed)), 'Packed resumed snapshots differ from fresh')
    document.setText(replacement)
    equal(document.semantics().revision, before.exact.revision + 2, 'Packed replacement advanced revision incorrectly')
    fresh.setText(replacement)
    equal(withoutRevisions(views(document, replacement)), withoutRevisions(views(fresh, replacement)), 'Packed replacement snapshots differ from fresh')
    document.edit(replacement.length, replacement.length, '\uDE00')
    const paired = replacement + '\uDE00'
    const after = views(document, paired)
    fresh.setText(paired)
    equal(withoutRevisions(after), withoutRevisions(views(fresh, paired)), 'Packed split-surrogate edit differs from fresh')
    memory.grow(1)
    equal(views(document, paired), after, 'Packed growth after replacement changed snapshots')
    equal(views(sibling, siblingSource), siblingBefore, 'Packed edits changed an independent document')
    document.dispose()
    document.dispose()
    equal(JSON.stringify(before), saved, 'Packed exact/open/ended snapshots changed after edits, growth, or disposal')
    equal(views(sibling, siblingSource), siblingBefore, 'Packed disposal changed an independent document')
    sibling.edit(siblingSource.length, siblingSource.length, '**')
    views(sibling, siblingSource + '**')
    return { memoryGrowths: 2, retainedSnapshots: 3 }
  } finally {
    document.dispose()
    fresh.dispose()
    sibling.dispose()
  }
}

export async function check(order, options = {}, hostOptions = {}) {
  const memory = await initialize(order, options, hostOptions)
  const lifecycle = checkLifecycle(memory)
  const source = '# Title\n\n**strong** and [link](/target)\n\n```js\nlet x = 1\n```\n'
  const first = new MarkdownDocument()
  const sibling = new MarkdownDocument()
  try {
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
    return { order, records: before.decorations.length / 4, lifecycle }
  } finally {
    first.dispose()
    sibling.dispose()
  }
}

function loadHostGrammar(options) {
  const grammar = options.grammar ?? new URL('./node_modules/tree-sitter-md/tree-sitter-markdown.wasm', import.meta.url)
  return Language.load(grammar instanceof URL ? grammar.pathname : grammar)
}
