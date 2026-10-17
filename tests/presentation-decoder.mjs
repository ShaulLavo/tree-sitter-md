import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodePresentation, decodeSemanticRoot } from '../js/semantic.js'

const range = { start: 0, end: 5 }
function payload(inline = { type: 'text', value: 'hello', range }) {
  return {
    root: { type: 'root', range, children: [{ type: 'paragraph', range, children: [inline] }] },
    input: 'open', provisional: [], suppressed: [], references: [],
  }
}
function decode(value, input = 'open') {
  return decodePresentation(JSON.stringify({ ...value, input }), 5, input)
}

test('presentation decoder accepts exact roots in both modes', () => {
  const value = payload()
  assert.deepEqual(decode(value), value)
  assert.deepEqual(decode(value, 'ended'), { ...value, input: 'ended' })
  assert.deepEqual(decodeSemanticRoot(JSON.stringify(value.root), 5), value.root)
})

test('presentation variants work recursively without weakening exact semantics', () => {
  for (const pending of [
    { type: 'pendingLink', range, children: [{ type: 'text', value: 'hello', range }] },
    { type: 'pendingImage', range, alt: 'hello' },
    { type: 'pendingMath', range, value: 'hello' },
  ]) {
    const value = payload({ type: 'strong', range, children: [pending] })
    value.provisional.push({ path: ['children', 0, 'children', 0, 'children', 0], reason: 'incomplete' })
    assert.deepEqual(decode(value), value)
    assert.throws(() => decode(value, 'ended'), TypeError)
    assert.throws(() => decodeSemanticRoot(JSON.stringify(value.root), 5), TypeError)
    assert.throws(() => decode(payload({ ...pending, url: '/invented' })), TypeError)
    assert.throws(() => decode(payload({ ...pending, title: null })), TypeError)
  }
})

test('presentation decoder rejects invalid metadata and source ranges', () => {
  const controls = [
    value => { value.provisional = [{ path: ['children', 4], reason: 'incomplete' }] },
    value => { value.provisional = [{ path: ['range', 0], reason: 'incomplete' }] },
    value => { value.provisional = [{ path: ['children', 0, 'children'], reason: 'incomplete' }] },
    value => { value.provisional = [{ path: [], reason: 'incomplete' }] },
    value => { value.provisional = [{ path: ['children', 0], reason: '' }] },
    value => { value.suppressed = [{ range: { start: 4, end: 6 }, reason: 'marker' }] },
    value => { value.suppressed = [{ range: { start: 2, end: 2 }, reason: 'marker' }] },
    value => { value.references = [{ kind: 'image', identifier: 'id', range, resolution: 'unresolved' }] },
    value => { value.references = [{ kind: 'link', identifier: 'id', range, resolution: 'pending' }] },
    value => { value.root.children[0].range.end = 6 },
    value => { value.root.children[0].children[0].range.start = 0.5 },
    value => { delete value.suppressed },
  ]
  for (const mutate of controls) {
    const value = structuredClone(payload())
    mutate(value)
    assert.throws(() => decode(value), TypeError)
  }
})

test('ended mode rejects live metadata and pending nodes even without metadata', () => {
  const live = payload()
  live.suppressed.push({ range, reason: 'marker' })
  assert.throws(() => decode(live, 'ended'), TypeError)
  assert.throws(() => decode(payload({ type: 'pendingImage', range, alt: '' }), 'ended'), TypeError)
  assert.throws(() => decodePresentation(JSON.stringify(payload()), 5, 'paused'), TypeError)
})

test('presentation decoder verifies the native input mode', () => {
  assert.throws(() => decodePresentation(JSON.stringify(payload()), 5, 'ended'), TypeError)
  const value = payload()
  delete value.input
  assert.throws(() => decodePresentation(JSON.stringify(value), 5, 'open'), TypeError)
})

test('pending display math is a presentation block', () => {
  const value = payload()
  value.root.children = [{ type: 'pendingMath', range, value: 'hello' }]
  assert.deepEqual(decode(value), value)
  assert.throws(() => decode(value, 'ended'), TypeError)
})
