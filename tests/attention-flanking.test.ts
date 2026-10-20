import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { init, MarkdownDocument } from '../js/index.js'
import type { SemanticInline } from '../js/semantic.js'

await init()
const options = { gfm: true, cjk: true, math: true }
const text = (value: string, start: number, end: number): SemanticInline => ({ type: 'text', value, range: { start, end } })
const span = (type: 'emphasis' | 'strong' | 'delete', start: number, end: number, children: readonly SemanticInline[]): SemanticInline => ({ type, range: { start, end }, children })

function roots(document: MarkdownDocument) {
  return [document.semantics().root, document.presentation({ input: 'open' }).root,
    document.presentation({ input: 'ended' }).root]
}

function check(source: string, expected: readonly SemanticInline[]): void {
  const document = new MarkdownDocument(options)
  try {
    document.setText(source + '\n\n')
    for (const root of roots(document)) {
      const paragraph = root.children[0]
      assert.equal(paragraph?.type, 'paragraph')
      if (paragraph?.type !== 'paragraph') continue
      assert.deepEqual(paragraph.children, expected)
    }
    assert.equal(document.presentation({ input: 'ended' }).source, source + '\n\n')
  } finally { document.dispose() }
}

for (const [source, prefix, value, suffix] of [
  ['日本語**強調。**続き', '日本語', '強調。', '続き'],
  ['中文**（强调）**文字', '中文', '（强调）', '文字'],
  ['**강조(괄호)**문장', '', '강조(괄호)', '문장'],
  ['𠮷**（字）**続き', '𠮷', '（字）', '続き'],
  ['漢\u{e0100}**（字）**続き', '漢\u{e0100}', '（字）', '続き'],
  ['和**「字」**文', '和', '「字」', '文'],
  ['한글**(문자)**문장', '한글', '(문자)', '문장'],
  ['𠀀**(字)**𠀁', '𠀀', '(字)', '𠀁'],
  ['字\u{e0100}**(字)**字', '字\u{e0100}', '(字)', '字'],
  ['“\ufe01**字**”\ufe01', '“\ufe01', '字', '”\ufe01'],
  ['😀**「x」**😀', '😀', '「x」', '😀'],
]) {
  test('preserve CJK and scalar flanks: ' + source, () => {
    const start = prefix.length
    const end = start + value.length + 4
    const before = prefix ? [text(prefix, 0, start)] : []
    check(source, before.concat([span('strong', start, end,
      [text(value, start + 2, end - 2)]), text(suffix, end, source.length)]))
  })
}

test('mixed closing marker keeps seed189 inner emphasis and literal prefix', () => {
  const source = 'A **see*_ me| a_ | b |\n|---|---|\nss'
  const document = new MarkdownDocument(options)
  try {
    document.setText(source)
    const expected: readonly SemanticInline[] = [text('A *', 0, 3), span('emphasis', 3, 8, [text('see', 4, 7)]),
      text('_ me| a_ | b |', 8, 22), { type: 'break', range: { start: 22, end: 23 }, hard: false },
      text('|---|---|', 23, 32), { type: 'break', range: { start: 32, end: 33 }, hard: false }, text('ss', 33, 35)]
    for (const root of [document.semantics().root, document.presentation({ input: 'ended' }).root]) {
      const paragraph = root.children[0]
      assert.equal(paragraph?.type, 'paragraph')
      if (paragraph?.type !== 'paragraph') continue
      assert.deepEqual(paragraph.children, expected)
    }
    const open = document.presentation({ input: 'open' })
    const tail = expected.slice(1)
    assert.deepEqual(open.root.children[0], { type: 'paragraph', range: { start: 0, end: source.length },
      children: [text('A ', 0, 2), span('emphasis', 2, source.length, tail)] })
    assert.deepEqual(open.provisional, [{ path: ['children', 0, 'children', 1], reason: 'unclosed-delimiter' }])
    assert.deepEqual(document.presentation({ input: 'ended' }).provisional, [])
  } finally { document.dispose() }
})

test('mixed opening marker keeps seed197 first paragraph literal', () => {
  const source = 'A *_*see&a\n\nmp[x];ded**&amp; message'
  const document = new MarkdownDocument(options)
  try {
    document.setText(source)
    for (const root of roots(document)) {
      assert.deepEqual(root.children[0], { type: 'paragraph', range: { start: 0, end: 10 },
        children: [text('A *_*see&a', 0, 10)] })
    }
  } finally { document.dispose() }
})

test('retain original rule-of-three lengths after consuming a run', () => {
  check('a***b**c*', [text('a', 0, 1), span('emphasis', 1, 9,
    [span('strong', 2, 7, [text('b', 4, 5)]), text('c', 7, 8)])])
})

test('tilde neighbors remain attention markers', () => {
  check('A *~*see', [text('A ', 0, 2), span('emphasis', 2, 5, [text('~', 3, 4)]), text('see', 5, 8)])
  check('和~~「字」~~文', [text('和', 0, 1), span('delete', 1, 8, [text('「字」', 3, 6)]), text('文', 8, 9)])
})

test('code and math keep interior markers opaque', () => {
  check('`*_*` $$*_*$$', [{ type: 'code', range: { start: 0, end: 5 }, value: '*_*', sourceValue: '*_*' },
    text(' ', 5, 6), { type: 'math', range: { start: 6, end: 13 }, value: '*_*' }])
})

function compareFresh(document: MarkdownDocument, source: string): void {
  const fresh = new MarkdownDocument(options)
  try {
    fresh.setText(source)
    assert.deepEqual(roots(document), roots(fresh))
    assert.equal(document.presentation({ input: 'open' }).source, source)
    assert.equal(document.presentation({ input: 'ended' }).source, source)
  } finally { fresh.dispose() }
}

for (const source of ['A **see*_ me| a_ | b |\n|---|---|\nss',
  'A *_*see&a\n\nmp[x];ded**&amp; message', 'A*\n\n **see(h&a--|\n/*_*ex_ad- ed\n\n',
  '--\ud83e*\uddd1**[x]: /target\ntext**end', '😀**「x」**😀']) {
  test('incremental edits and undo match fresh exact/open/ended: ' + JSON.stringify(source), () => {
    const document = new MarkdownDocument(options)
    try {
      document.setText('')
      document.edit(0, 0, source)
      compareFresh(document, source)
      const at = source.indexOf('*')
      document.edit(at, at + 1, '_')
      compareFresh(document, source.slice(0, at) + '_' + source.slice(at + 1))
      document.edit(at, at + 1, '*')
      compareFresh(document, source)
    } finally { document.dispose() }
  })
}

test('scalar emoji neighbors do not expose surrogate halves as punctuation', () => {
  check('a**b**🧑', [text('a', 0, 1), span('strong', 1, 6, [text('b', 3, 4)]), text('🧑', 6, 8)])
  check('🧑**b**a', [text('🧑', 0, 2), span('strong', 2, 7, [text('b', 4, 5)]), text('a', 7, 8)])
})

test('mixed closing slash direction keeps seed198 authored text literal', () => {
  const source = 'A*\n\n **see(h&a--|\n/*_*ex_ad- ed\n\n'
  const document = new MarkdownDocument(options)
  try {
    document.setText(source)
    const expected = { type: 'paragraph', range: { start: 5, end: 31 }, children: [
      text('**see(h&a--|', 5, 17), { type: 'break', range: { start: 17, end: 18 }, hard: false },
      text('/*_*ex_ad- ed', 18, 31)] }
    for (const root of roots(document)) assert.deepEqual(root.children[1], expected)
  } finally { document.dispose() }
})

test('original delimiter runs keep their rule-of-three allocation', () => {
  const source = 'A ****sd** me**ssage.'
  check(source, [text('A **', 0, 4), span('strong', 4, 10, [text('sd', 6, 8)]), text(' me**ssage.', 10, source.length)])
  check('*a\\**', [span('emphasis', 0, 5, [text('a*', 1, 4)])])
  check('*_a_*', [span('emphasis', 0, 5, [span('emphasis', 1, 4, [text('a', 2, 3)])])])
  check('*~~a~~*', [span('emphasis', 0, 7, [span('delete', 1, 6, [text('a', 3, 4)])])])
})

for (const source of ['a*_b*', 'a**_b**', '*a_*b']) {
  test('adjacent marker punctuation retains literal ' + source, () => check(source, [text(source, 0, source.length)]))
}

const originals: readonly { readonly seed: number; readonly revision: number; readonly live: boolean;
  readonly source: string; readonly sourceIdentity: { readonly utf16Units: number; readonly utf16LeSha256: string } }[] =
  JSON.parse(readFileSync(new URL('./fixtures/attention-originals.json', import.meta.url), 'utf8'))

for (const row of originals) {
  test(`original attention source units survive seed${row.seed} revision${row.revision} live=${row.live}`, () => {
    assert.equal(row.source.length, row.sourceIdentity.utf16Units)
    assert.equal(createHash('sha256').update(Buffer.from(row.source, 'utf16le')).digest('hex'), row.sourceIdentity.utf16LeSha256)
    const document = new MarkdownDocument(options)
    try {
      document.setText('')
      document.edit(0, 0, row.source)
      compareFresh(document, row.source)
      document.reparse()
      compareFresh(document, row.source)
    } finally { document.dispose() }
  })
}
