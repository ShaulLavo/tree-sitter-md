import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'

await init()

const options = { gfm: true, cjk: true, math: true }
const range = (start, end) => ({ start, end })
const node = (type, start, end, fields = {}) => ({ type, range: range(start, end), ...fields })
const text = (value, start, end) => node('text', start, end, { value })
const reference = (kind, identifier, start, end, resolution) => ({ kind, identifier, range: range(start, end), resolution })

function descendants(current, type) {
  const children = current.children ?? current.items ?? current.rows ?? current.cells ?? []
  return (current.type === type ? [current] : []).concat(children.flatMap(child => descendants(child, type)))
}

function observation(result) {
  return { root: result.root, provisional: result.provisional, suppressed: result.suppressed, references: result.references }
}

function verify(document, source, references) {
  const open = document.presentation({ input: 'open' })
  const ended = document.presentation({ input: 'ended' })
  assert.equal(open.source, source)
  assert.equal(ended.source, source)
  assert.deepEqual(open.root.range, range(0, source.length))
  assert.deepEqual(ended.root, document.semantics().root)
  assert.deepEqual(open.references, references)
  assert.deepEqual(ended.references, references)
  assert.deepEqual(ended.provisional, [])
  assert.deepEqual(ended.suppressed, [])
  assert.equal(open.revision, ended.revision)
  assert.deepEqual(document.presentation({ input: 'open' }), open)
  return open
}

function compareFresh(document, source) {
  const fresh = new MarkdownDocument(options)
  try {
    fresh.setText(source)
    for (const input of ['open', 'ended']) {
      assert.deepEqual(observation(document.presentation({ input })), observation(fresh.presentation({ input })))
    }
  } finally {
    fresh.dispose()
  }
}

function usages(source, resolution) {
  const link = source.indexOf('[x][id]')
  const image = source.indexOf('![alt][id]')
  return [reference('link', 'id', link, link + 7, resolution), reference('link', 'id', image, image + 10, resolution)]
}

function assertDestinations(result, url) {
  assert.deepEqual(descendants(result.root, 'link').map(child => child.url), [url])
  assert.deepEqual(descendants(result.root, 'image').map(child => child.url), [url])
}

test('full, collapsed, shortcut and image references report their authored ranges and normalized identity', () => {
  const document = new MarkdownDocument(options)
  const source = '[Full][ID] [ID][] [ID] ![alt][ID]\n\n[id]: /go "Guide"'
  try {
    document.setText(source)
    const result = verify(document, source, [
      reference('link', 'id', 0, 10, 'resolved'),
      reference('link', 'id', 11, 17, 'resolved'),
      reference('link', 'id', 18, 22, 'resolved'),
      reference('link', 'id', 23, 33, 'resolved'),
    ])
    assert.deepEqual(descendants(result.root, 'link').map(child => [child.url, child.title]), [['/go', 'Guide'], ['/go', 'Guide'], ['/go', 'Guide']])
    assert.deepEqual(descendants(result.root, 'image').map(child => [child.alt, child.url, child.title]), [['alt', '/go', 'Guide']])
    assert.equal(descendants(result.root, 'definition').length, 1)
  } finally {
    document.dispose()
  }
})

test('unresolved link, image and footnote dependencies leave later ordinary prose visible', () => {
  const document = new MarkdownDocument(options)
  const source = '[x][id] ![alt][id] [^N]\n\nTail'
  try {
    document.setText(source)
    const result = verify(document, source, usages(source, 'unresolved').concat([
      reference('footnote', 'n', 19, 23, 'unresolved'),
    ]))
    assert.deepEqual(result.root.children.map(child => child.type), ['paragraph', 'paragraph'])
    assert.deepEqual(result.root.children[0].children, [text('[x][id] ![alt][id] [^N]', 0, 23)])
    assert.deepEqual(result.root.children[1].children, [text('Tail', 25, 29)])
    assert.deepEqual(result.provisional, [])
  } finally {
    document.dispose()
  }
})

test('late, changed, duplicate, deleted and preceding definitions refresh links and images', () => {
  const document = new MarkdownDocument(options)
  const prefix = '[x][id] ![alt][id]\n\nTail'
  let source = prefix
  let retained
  let saved
  try {
    document.setText(source)
    verify(document, source, usages(source, 'unresolved'))
    const definitions = '\n\n[id]: /first\n[id]: /second'
    document.edit(source.length, source.length, definitions)
    source += definitions
    retained = verify(document, source, usages(source, 'resolved'))
    saved = structuredClone(retained)
    assertDestinations(retained, '/first')
    assert.deepEqual(descendants(retained.root, 'definition').map(child => child.url), ['/first', '/second'])
    const valueAt = source.indexOf('/first')
    document.edit(valueAt, valueAt + 6, '/fresh')
    source = source.slice(0, valueAt) + '/fresh' + source.slice(valueAt + 6)
    assertDestinations(verify(document, source, usages(source, 'resolved')), '/fresh')
    compareFresh(document, source)
    const firstAt = source.indexOf('[id]: /fresh')
    const secondAt = source.indexOf('[id]: /second')
    document.edit(firstAt, secondAt, '')
    source = source.slice(0, firstAt) + source.slice(secondAt)
    const fallback = verify(document, source, usages(source, 'resolved'))
    assertDestinations(fallback, '/second')
    assert.deepEqual(descendants(fallback.root, 'definition').map(child => child.url), ['/second'])
    compareFresh(document, source)
    document.edit(prefix.length, source.length, '')
    source = prefix
    const removed = verify(document, source, usages(source, 'unresolved'))
    assert.deepEqual(descendants(removed.root, 'definition'), [])
    assert.deepEqual(descendants(removed.root, 'link'), [])
    assert.deepEqual(descendants(removed.root, 'image'), [])
    assert.deepEqual(removed.root.children[0].children, [text('[x][id] ![alt][id]', 0, 18)])
    source = '[id]: /before\n\n' + prefix
    document.setText(source)
    assertDestinations(verify(document, source, usages(source, 'resolved')), '/before')
    compareFresh(document, source)
    assert.deepEqual(retained, saved)
  } finally {
    document.dispose()
  }
  assert.deepEqual(retained, saved)
})

test('footnote dependencies follow body edits, duplicate removal, undo and source replacement', () => {
  const document = new MarkdownDocument(options)
  const prefix = 'See [^N].\n\nTail'
  const use = resolution => [reference('footnote', 'n', 4, 8, resolution)]
  let source = prefix
  try {
    document.setText(source)
    verify(document, source, use('unresolved'))
    const definitions = '\n\n[^n]: First.\n\n[^N]: Second.'
    document.edit(source.length, source.length, definitions)
    source += definitions
    const resolved = verify(document, source, use('resolved'))
    assert.deepEqual(descendants(resolved.root, 'footnoteReference'), [node('footnoteReference', 4, 8, { identifier: 'n' })])
    assert.deepEqual(descendants(resolved.root, 'footnoteDefinition').map(child => child.identifier), ['n', 'n'])
    assert.deepEqual(descendants(resolved.root, 'footnoteDefinition').map(child => descendants(child, 'text')[0].value), ['First.', 'Second.'])
    const bodyAt = source.indexOf('First.')
    document.edit(bodyAt, bodyAt + 6, 'Edited.')
    source = source.slice(0, bodyAt) + 'Edited.' + source.slice(bodyAt + 6)
    const edited = verify(document, source, use('resolved'))
    assert.equal(descendants(descendants(edited.root, 'footnoteDefinition')[0], 'text')[0].value, 'Edited.')
    const firstAt = source.indexOf('[^n]:')
    const secondAt = source.indexOf('[^N]:')
    const removedText = source.slice(firstAt, secondAt)
    document.edit(firstAt, secondAt, '')
    source = source.slice(0, firstAt) + source.slice(secondAt)
    const remaining = verify(document, source, use('resolved'))
    assert.equal(descendants(remaining.root, 'footnoteDefinition').length, 1)
    assert.equal(descendants(descendants(remaining.root, 'footnoteDefinition')[0], 'text')[0].value, 'Second.')
    compareFresh(document, source)
    document.edit(firstAt, firstAt, removedText)
    source = source.slice(0, firstAt) + removedText + source.slice(firstAt)
    assert.deepEqual(observation(verify(document, source, use('resolved'))), observation(edited))
    document.edit(prefix.length, source.length, '')
    source = prefix
    const unresolved = verify(document, source, use('unresolved'))
    assert.deepEqual(descendants(unresolved.root, 'footnoteReference'), [])
    assert.deepEqual(descendants(unresolved.root, 'footnoteDefinition'), [])
    source = '[^n]: Replacement.\n\n' + prefix
    document.setText(source)
    const at = source.indexOf('[^N]')
    const replaced = verify(document, source, [reference('footnote', 'n', at, at + 4, 'resolved')])
    assert.equal(descendants(descendants(replaced.root, 'footnoteDefinition')[0], 'text')[0].value, 'Replacement.')
    compareFresh(document, source)
  } finally {
    document.dispose()
  }
})

test('link and footnote identifiers resolve in separate namespaces inside mapped containers', () => {
  const document = new MarkdownDocument(options)
  const source = '> - [x][a] [^a] ![img][a]\n\n[a]: /go\n\n[^a]: note'
  try {
    document.setText(source)
    const result = verify(document, source, [
      reference('link', 'a', 4, 10, 'resolved'),
      reference('footnote', 'a', 11, 15, 'resolved'),
      reference('link', 'a', 16, 25, 'resolved'),
    ])
    assert.equal(result.root.children[0].type, 'quote')
    assert.equal(result.root.children[0].children[0].type, 'list')
    assertDestinations(result, '/go')
    assert.deepEqual(descendants(result.root, 'footnoteReference'), [node('footnoteReference', 11, 15, { identifier: 'a' })])
  } finally {
    document.dispose()
  }
})

test('reference-looking escaped text, code, HTML and inline destinations create no dependency records', () => {
  const document = new MarkdownDocument(options)
  const source = '\\[x\\]\\[id\\] `[x][id]` <span title="[x][id]"> [x](/go) ![a](/img)\n\n```\n[x][id]\n```'
  try {
    document.setText(source)
    const result = verify(document, source, [])
    assert.deepEqual(descendants(result.root, 'link').map(child => child.url), ['/go'])
    assert.deepEqual(descendants(result.root, 'image').map(child => child.url), ['/img'])
  } finally {
    document.dispose()
  }
})

test('a later bracket cannot reactivate an outer link opener after an inner link consumes it', () => {
  const document = new MarkdownDocument(options)
  const source = '[a [b](/u) [c]][d]\n\n[d]: /d'
  try {
    document.setText(source)
    const result = verify(document, source, [
      reference('link', 'c', 11, 14, 'unresolved'),
      reference('link', 'd', 15, 18, 'resolved'),
    ])
    assert.deepEqual(result.root.children[0], node('paragraph', 0, 18, { children: [
      text('[a ', 0, 3),
      node('link', 3, 10, { url: '/u', title: null, children: [text('b', 4, 5)] }),
      text(' [c]]', 10, 15),
      node('link', 15, 18, { url: '/d', title: null, children: [text('d', 16, 17)] }),
    ] }))
    assert.deepEqual(result.root, document.semantics().root)
    assert.deepEqual(document.presentation({ input: 'open' }).root, result.root)
  } finally {
    document.dispose()
  }
})

test('latent nested reference dependencies reclassify an earlier outer inline link', () => {
  const document = new MarkdownDocument(options)
  const prefix = '[outer [inner][missing]](/url)'
  try {
    document.setText(prefix)
    const before = verify(document, prefix, [reference('link', 'missing', 7, 23, 'unresolved')])
    assert.equal(before.root.children[0].children.length, 1)
    const outer = before.root.children[0].children[0]
    assert.equal(outer.type, 'link')
    assert.equal(outer.url, '/url')
    assert.deepEqual(outer.range, range(0, 30))
    assert.ok(outer.children.every(child => child.type === 'text'))
    assert.equal(outer.children.map(child => child.value).join(''), 'outer [inner][missing]')
    assert.equal(outer.children[0].range.start, 1)
    assert.equal(outer.children.at(-1).range.end, 23)
    for (const child of outer.children) {
      assert.equal(prefix.slice(child.range.start, child.range.end), child.value)
    }
    const suffix = '\n\n[missing]: /m'
    document.edit(prefix.length, prefix.length, suffix)
    const after = verify(document, prefix + suffix, [reference('link', 'missing', 7, 23, 'resolved')])
    assert.deepEqual(after.root.children[0], node('paragraph', 0, 30, { children: [
      text('[outer ', 0, 7),
      node('link', 7, 23, { url: '/m', title: null, children: [text('inner', 8, 13)] }),
      text('](/url)', 23, 30),
    ] }))
    compareFresh(document, prefix + suffix)
    document.edit(prefix.length, prefix.length + suffix.length, '')
    assert.deepEqual(observation(verify(document, prefix, [reference('link', 'missing', 7, 23, 'unresolved')])), observation(before))
    compareFresh(document, prefix)
  } finally {
    document.dispose()
  }
})

test('reference ranges map astral source and footnote-body content back to the original document', () => {
  const document = new MarkdownDocument(options)
  const source = '🙂 [^n]\n\n> - [x][ID]\n\n[id]: /go\n\n[^n]: body [y][id]'
  const first = source.indexOf('[x]'), nested = source.indexOf('[y]')
  try {
    document.setText(source)
    const result = verify(document, source, [
      reference('footnote', 'n', 3, 7, 'resolved'),
      reference('link', 'id', first, first + 7, 'resolved'),
      reference('link', 'id', nested, nested + 7, 'resolved'),
    ])
    const links = descendants(result.root, 'link')
    assert.deepEqual(links.map(child => child.range), [range(first, first + 7), range(nested, nested + 7)])
    assert.deepEqual(links.map(child => child.url), ['/go', '/go'])
    compareFresh(document, source)
  } finally {
    document.dispose()
  }
})

test('reference identity uses native case folding and whitespace normalization', () => {
  const document = new MarkdownDocument(options)
  const source = '[x][ A\tB ]\n\n[a b]: /go'
  const useEnd = source.indexOf('\n')
  try {
    document.setText(source)
    const result = verify(document, source, [reference('link', 'a b', 0, useEnd, 'resolved')])
    assert.deepEqual(descendants(result.root, 'link').map(child => child.url), ['/go'])
    document.edit(useEnd, source.length, '')
    verify(document, source.slice(0, useEnd), [reference('link', 'a b', 0, useEnd, 'unresolved')])
  } finally {
    document.dispose()
  }
})

test('a full-reference fallback can own a later overlapping full reference', () => {
  const document = new MarkdownDocument(options)
  const source = '[a][b][c]\n\n[c]: /go'
  try {
    document.setText(source)
    const result = verify(document, source, [
      reference('link', 'b', 0, 6, 'unresolved'),
      reference('link', 'c', 3, 9, 'resolved'),
    ])
    assert.deepEqual(descendants(result.root, 'link'), [node('link', 3, 9, {
      url: '/go', title: null, children: [text('b', 4, 5)],
    })])
    compareFresh(document, source)
  } finally {
    document.dispose()
  }
})

test('a completed reference in an empty-task-shaped item remains visible', () => {
  const document = new MarkdownDocument(options)
  const source = '[x]: /go\n\n- [x]'
  const at = source.lastIndexOf('[x]')
  try {
    document.setText(source)
    const result = verify(document, source, [reference('link', 'x', at, at + 3, 'resolved')])
    assert.deepEqual(result.suppressed, [])
    assert.deepEqual(result.root, document.semantics().root)
    assert.deepEqual(descendants(result.root, 'link'), [node('link', at, at + 3, {
      url: '/go', title: null, children: [text('x', at + 1, at + 2)],
    })])
  } finally {
    document.dispose()
  }
})

test('reference dependencies survive image-alt flattening', () => {
  const document = new MarkdownDocument(options)
  const prefix = '![alt [inner][id]](/img)'
  try {
    document.setText(prefix)
    const before = verify(document, prefix, [reference('link', 'id', 6, 17, 'unresolved')])
    assert.deepEqual(descendants(before.root, 'image').map(child => [child.alt, child.url]), [['alt [inner][id]', '/img']])
    const suffix = '\n\n[id]: /go'
    document.edit(prefix.length, prefix.length, suffix)
    const after = verify(document, prefix + suffix, [reference('link', 'id', 6, 17, 'resolved')])
    assert.deepEqual(descendants(after.root, 'image').map(child => [child.alt, child.url]), [['alt inner', '/img']])
    compareFresh(document, prefix + suffix)
  } finally {
    document.dispose()
  }
})

test('disabled GFM keeps footnote-looking syntax in the link-reference namespace', () => {
  const document = new MarkdownDocument({ gfm: false })
  try {
    document.setText('[^n]')
    const before = verify(document, '[^n]', [reference('link', '^n', 0, 4, 'unresolved')])
    assert.deepEqual(descendants(before.root, 'text'), [text('[', 0, 1), text('^n', 1, 3), text(']', 3, 4)])
    const source = '[^n]\n\n[^n]: /go'
    document.setText(source)
    const after = verify(document, source, [reference('link', '^n', 0, 4, 'resolved')])
    assert.deepEqual(descendants(after.root, 'link').map(child => child.url), ['/go'])
    assert.deepEqual(descendants(after.root, 'footnoteReference'), [])
  } finally {
    document.dispose()
  }
})

for (const marker of ['[ ]', '[x]', '[X]']) {
  test('an empty task before a later definition keeps the definition outside its list: ' + marker, () => {
    const document = new MarkdownDocument(options)
    const prefix = '[late][id]\n\n- ' + marker
    const suffix = '\n\n[id]: /go'
    try {
      document.setText(prefix)
      document.presentation({ input: 'open' })
      document.edit(prefix.length, prefix.length, suffix)
      const refs = [reference('link', 'id', 0, 10, 'resolved')]
      if (marker !== '[ ]') refs.push(reference('link', 'x', 14, 17, 'unresolved'))
      const result = verify(document, prefix + suffix, refs)
      assert.deepEqual(result.root.children.map(child => child.type), ['paragraph', 'list', 'definition'])
      assert.equal(result.root.children[0].children[0].url, '/go')
      assert.equal(result.root.children[1].items[0].checked, null)
      assert.deepEqual(descendants(result.root.children[1], 'text').map(child => child.value), [marker])
      assert.deepEqual(result.root.children[1].range, range(12, 17))
      compareFresh(document, prefix + suffix)
    } finally {
      document.dispose()
    }
  })
}

for (const length of [999, 1000]) {
  test('reference identifiers honor the native CommonMark label limit: ' + length, () => {
    const document = new MarkdownDocument(options)
    const label = 'a'.repeat(length)
    const source = '[' + label + ']'
    try {
      document.setText(source)
      const refs = length === 999 ? [reference('link', label, 0, source.length, 'unresolved')] : []
      const result = verify(document, source, refs)
      assert.equal(descendants(result.root, 'text').map(child => child.value).join(''), source)
      const definitions = '\n\n[' + label + ']: /go'
      document.edit(source.length, source.length, definitions)
      const expected = length === 999 ? [reference('link', label, 0, source.length, 'resolved')] : []
      const withDefinition = verify(document, source + definitions, expected)
      assert.deepEqual(descendants(withDefinition.root, 'link').map(child => child.url), length === 999 ? ['/go'] : [])
    } finally {
      document.dispose()
    }
  })
}

test('long link text can use a short valid explicit reference identifier', () => {
  const document = new MarkdownDocument(options)
  const label = 'a'.repeat(1000)
  const prefix = '[' + label + '][id]'
  const source = prefix + '\n\n[id]: /go'
  try {
    document.setText(source)
    const result = verify(document, source, [reference('link', 'id', 0, prefix.length, 'resolved')])
    const links = descendants(result.root, 'link')
    assert.equal(links.length, 1)
    assert.equal(links[0].url, '/go')
    assert.equal(links[0].children[0].value, label)
  } finally {
    document.dispose()
  }
})

for (const length of [999, 1000]) {
  test('the label limit counts Unicode characters across UTF-8 source bytes: ' + length, () => {
    const document = new MarkdownDocument(options)
    const label = '中'.repeat(length)
    const use = '[' + label + ']'
    const source = use + '\n\n[' + label + ']: /go'
    try {
      document.setText(source)
      const expected = length === 999 ? [reference('link', label, 0, use.length, 'resolved')] : []
      const result = verify(document, source, expected)
      assert.deepEqual(descendants(result.root, 'link').map(child => child.url), length === 999 ? ['/go'] : [])
      compareFresh(document, source)
    } finally {
      document.dispose()
    }
  })
}
