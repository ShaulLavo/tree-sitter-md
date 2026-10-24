import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

// Only the host exports are stubbed; the binding accesses real high-address Wasm memory.
test('Wasm i32 pointers above 2 GiB are unsigned byte offsets', async t => {
  const memory = new WebAssembly.Memory({ initial: 32769, maximum: 32769 })
  const input = 0x80000000, output = input + 64, semantic = input + 128
  const root = { type: 'root', range: { start: 0, end: 0 }, children: [] }
  const encoded = new TextEncoder().encode(JSON.stringify(root))
  new Uint32Array(memory.buffer, output, 4).set([0, 2, 3, 4])
  new Uint8Array(memory.buffer, semantic, encoded.length).set(encoded)
  let releases = 0
  class Language {}
  const host = {
    Language,
    Parser: { async init() {} },
    heap: () => new Uint8Array(memory.buffer),
    loadExtension: async () => ({
      tsmd_new: () => 1,
      tsmd_input: () => input | 0,
      tsmd_set_text() {},
      tsmd_edit() {},
      tsmd_out: () => output | 0,
      tsmd_decorations: () => 4,
      tsmd_folds: () => 4,
      tsmd_highlights: () => 4,
      tsmd_injections: () => 4,
      tsmd_semantics: () => encoded.length,
      tsmd_source: () => input | 0,
      tsmd_presentation: (handle, ended) => {
        const span = { start: 0, end: 2 }
        const value = { input: ended ? 'ended' : 'open', provisional: [], suppressed: [], references: [],
          root: { type: 'root', range: span, children: [{ type: 'paragraph', range: span,
            children: [{ type: 'text', range: span, value: '\uFFFD\uD800' }] }] } }
        const bytes = new TextEncoder().encode(JSON.stringify(value))
        new Uint8Array(memory.buffer, semantic, bytes.length).set(bytes)
        return bytes.length
      },
      tsmd_semantic_out: () => semantic | 0,
      tsmd_semantic_release() { releases++ },
      tsmd_free() {},
    }),
  }
  const key = '__treeSitterMdUnsignedAddressHost'
  globalThis[key] = host
  const stub = `data:text/javascript,${encodeURIComponent(`export const { Language, Parser, heap, loadExtension } = globalThis.${key}`)}`
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'web-tree-sitter') return { url: stub, shortCircuit: true }
      return nextResolve(specifier, context)
    },
  })
  let binding
  try { binding = await import('../js/index.js?unsigned-address') }
  finally { hooks.deregister(); delete globalThis[key] }
  await binding.init({ grammar: new Language(), mathGrammar: new Language(), resolver: new Uint8Array() })
  const doc = new binding.MarkdownDocument()
  t.after(() => doc.dispose())
  await t.test('setText and edit write UTF-16 at the unsigned input address', () => {
    doc.setText('Aλ')
    assert.deepEqual(Array.from(new Uint16Array(memory.buffer, input, 2)), [65, 955])
    doc.edit(0, 2, '\u{1f600}')
    assert.deepEqual(Array.from(new Uint16Array(memory.buffer, input, 2)), [0xd83d, 0xde00])
  })
  await t.test('record readers copy from the unsigned output address', () => {
    for (const method of ['decorations', 'folds', 'highlights', 'injections']) {
      const records = doc[method](0, 2)
      assert.deepEqual(records, new Uint32Array([0, 2, 3, 4]))
      assert.notEqual(records.buffer, memory.buffer)
    }
  })
  await t.test('semantics validates and decodes the unsigned semantic address', t => {
    const empty = new binding.MarkdownDocument()
    t.after(() => empty.dispose())
    assert.deepEqual(empty.semantics().root, root)
    assert.equal(releases, 1)
  })
  await t.test('presentation copies original UTF-16 from an unsigned source address', () => {
    doc.setText('\0\uD800')
    const result = doc.presentation({ input: 'open' })
    assert.equal(result.source, '\0\uD800')
    assert.equal(result.root.children[0].children[0].value, '\uFFFD\uD800')
    assert.equal(releases, 2)
  })
})
