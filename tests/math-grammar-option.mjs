import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { init, MarkdownDocument } from '../js/index.js'

const source = '$$\nx\n$$\n'
const math = readFileSync(new URL('../tree-sitter-markdown-math.wasm', import.meta.url))
const types = doc => doc.semantics().root.children.map(child => child.type)

// Each option is checked in its own process because init() runs once per process.
const name = process.env.TSMD_MATH_OPTION
if (!name) {
  const { spawnSync } = await import('node:child_process')
  for (const option of ['mathGrammar', 'chatGrammar']) test(`init({ ${option} }) loads the math grammar`, () => {
    const run = spawnSync(process.execPath, ['--test', new URL(import.meta.url).pathname], { env: { ...process.env, TSMD_MATH_OPTION: option }, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stdout + run.stderr)
  })
  test('the old chat wasm path still resolves to the math grammar', () => {
    const require = createRequire(import.meta.url)
    assert.equal(require.resolve('tree-sitter-md/tree-sitter-markdown-chat.wasm'), require.resolve('tree-sitter-md/tree-sitter-markdown-math.wasm'))
  })
} else test(`${name} selects the grammar for math documents`, async () => {
  await init({ [name]: math })
  const doc = new MarkdownDocument({ gfm: true, math: true })
  try {
    doc.setText(source)
    assert.deepEqual(types(doc), ['math'])
    assert.equal(doc.semantics().profile, 'gfm-extended')
  } finally { doc.dispose() }
  const plain = new MarkdownDocument({ gfm: true })
  try {
    plain.setText(source)
    assert.equal(plain.semantics().profile, 'gfm')
  } finally { plain.dispose() }
})
