import host from 'web-tree-sitter/web-tree-sitter.wasm?url'
import grammar from '../../tree-sitter-markdown.wasm?url'
import resolver from '../../tree-sitter-md.wasm?url'

function check(condition, message) {
  if (!condition) throw new Error(message)
}

function equal(actual, expected, message) {
  check(JSON.stringify(actual) === JSON.stringify(expected), message)
}

function views(document, source) {
  const exact = document.semantics()
  const open = document.presentation({ input: 'open' })
  const ended = document.presentation({ input: 'ended' })
  equal(open.source, source, 'Browser open presentation changed received source')
  equal(ended.source, source, 'Browser ended presentation changed received source')
  equal(open.revision, exact.revision, 'Browser open read changed source revision')
  equal(open.input, 'open', 'Browser open input mode changed')
  equal(ended.input, 'ended', 'Browser ended input mode changed')
  equal(ended.provisional, [], 'Browser ended output retained provisional metadata')
  equal(ended.suppressed, [], 'Browser ended output retained suppression')
  const { source: ignoredSource, input, provisional, suppressed, references, ...canonical } = ended
  equal(canonical, exact, 'Browser ended output differs from complete exact semantics')
  equal(document.semantics(), exact, 'Browser presentation changed exact semantics')
  return { exact, open, ended }
}

async function run() {
  // Capture the real host memory so the fixture can force growth without a public runtime API.
  const instantiate = WebAssembly.instantiate
  let memory
  WebAssembly.instantiate = async function (...args) {
    const result = await instantiate.apply(this, args)
    const instance = result.instance ?? result
    if (instance.exports.memory) memory = instance.exports.memory
    return result
  }
  const { init, MarkdownDocument } = await import('../../js/index.js')
  const { heap, Parser } = await import('web-tree-sitter')
  try {
    await Parser.init({ locateFile: () => host })
    await init({ grammar, resolver })
  }
  finally { WebAssembly.instantiate = instantiate }
  check(memory instanceof WebAssembly.Memory, 'Runtime memory was not captured')
  const buffer = memory.toResizableBuffer()
  check(heap().buffer === buffer, 'Markdown must use the actual resizable host heap')
  let rawDecodeRejected = false
  try { new TextDecoder().decode(new Uint8Array(buffer, 0, 1)) }
  catch (error) { rawDecodeRejected = error instanceof TypeError }
  window.rawDecodeRejected = rawDecodeRejected

  const doc = new MarkdownDocument()
  const sibling = new MarkdownDocument({ gfm: false })
  const siblingSource = 'sibling **pending'
  let retained
  try {
    sibling.setText(siblingSource)
    const siblingBefore = views(sibling, siblingSource)
    doc.setText('ASCII café 中文 😀\0 end\n')
    memory.grow(1)
    const first = doc.semantics()
    const presented = doc.presentation({ input: 'open' })
    check(presented.source === 'ASCII café 中文 😀\0 end\n', 'Presentation lost received UTF-16 source')
    check(presented.input === 'open', 'Presentation lost input mode')
    check(JSON.stringify(presented.root) === JSON.stringify(first.root), 'P1 presentation changed exact semantics')
    const retainedPresentation = JSON.stringify(presented)
    const text = first.root.children[0].children.map(node => node.value).join('')
    check(text === 'ASCII café 中文 😀� end', `UTF-8 semantic text changed: ${JSON.stringify(text)}`)
    check(first.root.range.end === 'ASCII café 中文 😀\0 end\n'.length, 'UTF-16 source range changed')
    check(first.revision === 1, 'Initial revision changed')
    retained = JSON.stringify(first)
    doc.edit(0, 0, '**new**\n\n')
    memory.grow(1)
    check(doc.semantics().revision === 2, 'Semantics failed after edit and growth')
    check(doc.presentation({ input: 'ended' }).source === '**new**\n\nASCII café 中文 😀\0 end\n', 'Presentation failed after edit/growth')
    doc.setText('**outside *inside')
    const live = doc.presentation({ input: 'open' })
    const strong = live.root.children[0].children[0]
    check(strong.type === 'strong', 'Browser presentation lost provisional strong')
    check(strong.children[1].type === 'emphasis', 'Browser presentation lost nested provisional emphasis')
    check(strong.children[1].children[0].value === 'inside', 'Browser presentation lost provisional content')
    check(live.provisional.length === 2, 'Browser presentation lost provisional metadata')
    const ended = doc.presentation({ input: 'ended' })
    check(ended.revision === live.revision, 'Browser mode change advanced source revision')
    check(JSON.stringify(ended.root) === JSON.stringify(doc.semantics().root), 'Browser ended presentation differs from exact semantics')
    check(ended.provisional.length === 0, 'Browser ended presentation retained provisional metadata')
    const retainedEnded = JSON.stringify(ended)
    const liveViews = views(doc, '**outside *inside')
    for (const input of ['open', 'ended', 'ended', 'open'])
      equal(doc.presentation({ input }), liveViews[input], 'Browser metadata-only transition changed its snapshot')
    doc.reparse()
    equal(views(doc, '**outside *inside'), liveViews, 'Browser idle reparse changed snapshots or revision')
    const retainedLive = JSON.stringify(live)
    memory.grow(1)
    check(JSON.stringify(live) === retainedLive, 'Memory growth changed retained provisional snapshot')
    doc.setText('[label](https://exa')
    const pendingSnapshot = doc.presentation({ input: 'open' })
    const pending = pendingSnapshot.root.children[0].children[0]
    check(pending.type === 'pendingLink', 'Browser presentation lost pending link')
    check(!('url' in pending) && !('title' in pending), 'Browser pending link invented a destination')
    const retainedPending = JSON.stringify(pendingSnapshot)
    doc.setText('[late][id]\n\n- [ ]')
    const dependencies = doc.presentation({ input: 'open' })
    check(dependencies.root.children.length === 1, 'Browser emitted an empty trailing list')
    check(dependencies.suppressed[0]?.range.start === 12 && dependencies.suppressed[0]?.range.end === 17, 'Browser block suppression lost its source range')
    check(dependencies.references.length === 1 && dependencies.references[0].identifier === 'id' && dependencies.references[0].resolution === 'unresolved', 'Browser unresolved reference reporting changed')
    const retainedDependencies = JSON.stringify(dependencies)
    memory.grow(1)
    doc.edit(17, 17, '\n\n[id]: /target')
    const resolved = doc.presentation({ input: 'ended' })
    check(resolved.root.children[0].children[0].url === '/target', 'Browser late reference stayed unresolved')
    check(resolved.references[0].resolution === 'resolved', 'Browser late reference metadata stayed unresolved')
    check(JSON.stringify(resolved.root) === JSON.stringify(doc.semantics().root), 'Browser block/reference ended output changed exact semantics')
    check(JSON.stringify(dependencies) === retainedDependencies, 'Memory growth/edit changed retained reference snapshot')
    doc.edit(0, 0, 'before ')
    const revision = doc.semantics().revision
    const replacement = '\uFEFFreplacement\0\uFFFD\r\n\uD83D'
    doc.setText(replacement)
    const replaced = views(doc, replacement)
    equal(replaced.exact.revision, revision + 1, 'Browser source replacement advanced revision incorrectly')
    const retainedReplacement = JSON.stringify(replaced)
    doc.edit(replacement.length, replacement.length, '\uDE00')
    views(doc, replacement + '\uDE00')
    equal(views(sibling, siblingSource), siblingBefore, 'Browser edits or growth changed an independent document')
    check(JSON.stringify(first) === retained, 'Returned semantics must own their decoded strings')
    doc.dispose()
    check(JSON.stringify(first) === retained, 'Disposal changed a retained result')
    check(JSON.stringify(presented) === retainedPresentation, 'Disposal changed retained presentation')
    check(JSON.stringify(live) === retainedLive, 'Edits/disposal changed retained provisional snapshot')
    check(JSON.stringify(ended) === retainedEnded, 'Edits/growth/disposal changed retained ended snapshot')
    check(JSON.stringify(pendingSnapshot) === retainedPending, 'Edits/disposal changed retained pending link')
    check(JSON.stringify(dependencies) === retainedDependencies, 'Disposal changed retained reference snapshot')
    equal(JSON.stringify(replaced), retainedReplacement, 'Browser edit/disposal changed retained replacement snapshots')
    doc.dispose()
    equal(views(sibling, siblingSource), siblingBefore, 'Browser repeated disposal changed an independent document')
    sibling.edit(siblingSource.length, siblingSource.length, '**')
    views(sibling, siblingSource + '**')
  } finally {
    doc.dispose()
    sibling.dispose()
  }
  return { resizable: buffer.resizable, rawDecodeRejected, growths: 4, retainedBytes: retained.length }
}

run().then(result => { window.result = result }, error => { window.failure = error.stack })
