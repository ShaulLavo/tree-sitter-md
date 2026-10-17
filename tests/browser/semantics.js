import host from 'web-tree-sitter/web-tree-sitter.wasm?url'
import grammar from '../../tree-sitter-markdown.wasm?url'
import resolver from '../../tree-sitter-md.wasm?url'

function check(condition, message) {
  if (!condition) throw new Error(message)
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
  let retained
  try {
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
    doc.setText('replacement')
    check(doc.semantics().root.children[0].children[0].value === 'replacement', 'Later allocation changed semantics')
    check(JSON.stringify(first) === retained, 'Returned semantics must own their decoded strings')
    doc.dispose()
    check(JSON.stringify(first) === retained, 'Disposal changed a retained result')
    check(JSON.stringify(presented) === retainedPresentation, 'Disposal changed retained presentation')
  } finally { doc.dispose() }
  return { resizable: buffer.resizable, rawDecodeRejected, growths: 2, retainedBytes: retained.length }
}

run().then(result => { window.result = result }, error => { window.failure = error.stack })
