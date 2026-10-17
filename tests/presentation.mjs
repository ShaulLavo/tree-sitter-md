import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument, memoryBytes } from '../js/index.js'

await init()

function snapshot(document, input = 'open') {
  return document.presentation({ input })
}

function exact(document, source, input = 'open') {
  const result = snapshot(document, input)
  const semantic = document.semantics()
  assert.equal(result.source, source)
  assert.equal(result.input, input)
  assert.equal(result.revision, semantic.revision)
  assert.equal(result.profile, semantic.profile)
  assert.deepEqual(result.capabilities, semantic.capabilities)
  assert.deepEqual(result.root, semantic.root)
  assert.deepEqual(result.provisional, [])
  assert.deepEqual(result.suppressed, [])
  assert.deepEqual(result.references, [])
  return result
}

function plainValue(result) {
  return result.root.children[0].children[0].value
}

test('presentation modes are independent reads of exact semantics', () => {
  const document = new MarkdownDocument({ gfm: true, cjk: true, math: true })
  try {
    assert.equal(exact(document, '').revision, 0)
    document.setText('**bold** and **unfinished')
    const open = exact(document, '**bold** and **unfinished')
    const ended = exact(document, open.source, 'ended')
    const reopened = exact(document, open.source)
    assert.equal(open.revision, 1)
    assert.equal(ended.revision, 1)
    assert.deepEqual(reopened, open)
    document.reparse()
    assert.deepEqual(snapshot(document), open)
    document.edit(open.source.length, open.source.length, '**')
    assert.equal(exact(document, open.source + '**', 'ended').revision, 2)
    document.setText('replacement')
    assert.equal(exact(document, 'replacement').revision, 3)
  } finally {
    document.dispose()
  }
})

test('presentation preserves NUL independently from literal replacement characters', () => {
  const document = new MarkdownDocument()
  try {
    document.setText('a\0b\uFFFDc')
    const result = exact(document, 'a\0b\uFFFDc', 'ended')
    assert.equal(plainValue(result), 'a\uFFFDb\uFFFDc')
    document.edit(1, 2, '\uFFFD')
    assert.equal(exact(document, 'a\uFFFDb\uFFFDc').source.charCodeAt(1), 0xfffd)
    document.edit(3, 4, '\0')
    assert.equal(plainValue(exact(document, 'a\uFFFDb\0c')), 'a\uFFFDb\uFFFDc')
    document.setText('short')
    exact(document, 'short')
    document.setText('')
    exact(document, '')
  } finally {
    document.dispose()
  }
})

test('presentation retains BOM and CRLF source through boundary edits', () => {
  const document = new MarkdownDocument()
  try {
    document.setText('\uFEFFfirst\r\nsecond\rthird\n')
    exact(document, '\uFEFFfirst\r\nsecond\rthird\n')
    document.edit(7, 7, 'x')
    exact(document, '\uFEFFfirst\rx\nsecond\rthird\n')
    document.edit(7, 8, '')
    exact(document, '\uFEFFfirst\r\nsecond\rthird\n', 'ended')
  } finally {
    document.dispose()
  }
})

test('presentation retains lone surrogates and reassembles split UTF-16 pairs', () => {
  const document = new MarkdownDocument()
  try {
    document.setText('a\uD83D')
    assert.equal(plainValue(exact(document, 'a\uD83D')), 'a\uD83D')
    document.edit(2, 2, '\uDE00')
    assert.equal(plainValue(exact(document, 'a\uD83D\uDE00')), 'a😀')
    document.edit(1, 2, '')
    assert.equal(plainValue(exact(document, 'a\uDE00')), 'a\uDE00')
    document.edit(1, 1, '\uD83D')
    assert.equal(plainValue(exact(document, 'a😀', 'ended')), 'a😀')
    document.setText('\uDE00x\uD83D')
    assert.equal(plainValue(exact(document, '\uDE00x\uD83D')), '\uDE00x\uD83D')
  } finally {
    document.dispose()
  }
})

test('presentation source crosses binding copy chunks without losing UTF-16 units', () => {
  const document = new MarkdownDocument()
  const source = 'x'.repeat(32767) + '\uD83D\uDE00\0\uFFFD\r\n' + 'y'.repeat(32768) + '\uD83D'
  try {
    document.setText(source)
    exact(document, source)
    document.edit(32768, 32769, '\0')
    exact(document, source.slice(0, 32768) + '\0' + source.slice(32769), 'ended')
  } finally {
    document.dispose()
  }
})

test('presentation snapshots own nested trees, metadata and source after edits and disposal', () => {
  const document = new MarkdownDocument()
  try {
    document.setText('**before**\0')
    const before = snapshot(document)
    const savedBefore = structuredClone(before)
    document.edit(2, 8, 'after')
    const after = snapshot(document, 'ended')
    const savedAfter = structuredClone(after)
    assert.equal(after.source, '**after**\0')
    assert.equal(after.revision, before.revision + 1)
    assert.deepEqual(before, savedBefore)
    before.root.children[0].children[0].children[0].value = 'caller mutation'
    before.capabilities.gfm = false
    before.provisional.push({ caller: true })
    assert.deepEqual(snapshot(document, 'ended'), savedAfter)
    document.dispose()
    assert.deepEqual(after, savedAfter)
    assert.equal(before.source, savedBefore.source)
    assert.throws(() => snapshot(document), /disposed/)
    assert.throws(() => document.semantics(), /disposed/)
    assert.throws(() => document.setText('new'), /disposed/)
    assert.throws(() => document.edit(0, 0, 'new'), /disposed/)
  } finally {
    document.dispose()
  }
})

test('retained and fresh snapshots survive actual shared Wasm memory growth', () => {
  const document = new MarkdownDocument()
  const growth = new MarkdownDocument()
  try {
    document.setText('**retained**\0')
    const retained = snapshot(document)
    const saved = structuredClone(retained)
    const before = memoryBytes()
    growth.setText('x'.repeat(8_000_000))
    assert.ok(memoryBytes() > before, 'the test must exercise a new Wasm memory buffer')
    assert.deepEqual(retained, saved)
    assert.deepEqual(exact(document, saved.source), saved)
    growth.setText('sibling\0')
    exact(growth, 'sibling\0')
    growth.dispose()
    assert.deepEqual(snapshot(document), saved)
    document.edit(2, 10, 'updated')
    exact(document, '**updated**\0', 'ended')
    assert.deepEqual(retained, saved)
  } finally {
    document.dispose()
    growth.dispose()
  }
})

test('invalid presentation requests and failed mutations preserve document state', () => {
  const document = new MarkdownDocument()
  try {
    document.setText('text\0')
    const before = snapshot(document)
    for (const value of [undefined, null, {}, { input: 'paused' }, { input: 1 }, 'open', [], Object.assign([], { input: 'open' })]) {
      assert.throws(() => document.presentation(value), /presentation expects/)
      assert.deepEqual(snapshot(document), before)
    }
    const invalidEdits = [[-1, 0, 'x'], [2, 1, 'x'], [0, 6, 'x'], [0.5, 1, 'x'], [0, 0, null]]
    for (const args of invalidEdits) {
      assert.throws(() => document.edit(...args), /edit requires/)
      assert.deepEqual(snapshot(document), before)
    }
    assert.throws(() => document.setText(null), /text must be a string/)
    assert.deepEqual(snapshot(document), before)
  } finally {
    document.dispose()
  }
})
