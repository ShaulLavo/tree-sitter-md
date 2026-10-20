import assert from 'node:assert/strict'
import { test } from 'node:test'
import { init, MarkdownDocument } from '../js/index.js'

await init()

type Node = Record<string, unknown>

function object(value: unknown): value is Node {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function walk(value: unknown): Node[] {
  if (!object(value)) return []
  const children = ['children', 'items', 'rows', 'cells'].flatMap((key) =>
    Array.isArray(value[key]) ? value[key] : [],
  )
  return [value].concat(children.flatMap(walk))
}

function read(document: MarkdownDocument, source: string) {
  const { revision: _exactRevision, ...exact } = document.semantics()
  const { revision: _openRevision, ...open } = document.presentation({
    input: 'open',
  })
  const { revision: _endedRevision, ...ended } = document.presentation({
    input: 'ended',
  })
  assert.equal(open.source, source)
  assert.equal(ended.source, source)
  return { exact, open, ended }
}

function urls(root: unknown): unknown[] {
  return walk(root)
    .filter((node) => node.type === 'link')
    .map((node) => node.url)
}

function verifyOriginal(source: string, math: boolean): void {
  const document = new MarkdownDocument({ gfm: true, math })
  try {
    document.setText(source)
    const views = read(document, source)
    for (const view of Object.values(views)) {
      assert.deepEqual(urls(view.root), ['/u'])
      assert.deepEqual(
        walk(view.root).filter((node) => node.type === 'code'),
        [],
      )
      assert.deepEqual(
        walk(view.root)
          .filter((node) => node.type === 'definition')
          .map((node) => node.identifier),
        ['`a b`'],
      )
    }
  } finally {
    document.dispose()
  }
}

for (const ending of ['\n', '\r\n', '\r']) {
  for (const math of [false, true]) {
    test(`task-shaped first label preserves its reference definition ${JSON.stringify(ending)} math=${math}`, () => {
      verifyOriginal(
        '- [x][`a\n\tb`]\n\n[`a b`]: /u'.replaceAll('\n', ending),
        math,
      )
    })
  }
}

type Boundary = {
  readonly source: string
  readonly checked: readonly (boolean | null)[]
  readonly urls: readonly string[]
  readonly definitions: readonly string[]
}

const boundaries: readonly Boundary[] = [
  {
    source: '- [x][r]\n\n[r]: /u',
    checked: [null],
    urls: ['/u'],
    definitions: ['r'],
  },
  {
    source: '- [X][r]\n\n[r]: /u',
    checked: [null],
    urls: ['/u'],
    definitions: ['r'],
  },
  {
    source: '- [ ][r]\n\n[r]: /u',
    checked: [null],
    urls: ['/u'],
    definitions: ['r'],
  },
  {
    source: '- [z][r]\n\n[r]: /u',
    checked: [null],
    urls: ['/u'],
    definitions: ['r'],
  },
  {
    source: '- [x] [r]\n\n[r]: /u',
    checked: [true],
    urls: ['/u'],
    definitions: ['r'],
  },
  {
    source: '- [X]\t[r]\n\n[r]: /u',
    checked: [true],
    urls: ['/u'],
    definitions: ['r'],
  },
  {
    source: '- [ ] [r]\n\n[r]: /u',
    checked: [false],
    urls: ['/u'],
    definitions: ['r'],
  },
  {
    source: '- [\t] [r]\n\n[r]: /u',
    checked: [false],
    urls: ['/u'],
    definitions: ['r'],
  },
  {
    source: '- [x]\n  [r]\n\n[r]: /u',
    checked: [true],
    urls: ['/u'],
    definitions: ['r'],
  },
  {
    source: '- [x]\n\n  [r]\n\n[r]: /u',
    checked: [null],
    urls: ['/u'],
    definitions: ['r'],
  },
  { source: '- [x]', checked: [null], urls: [], definitions: [] },
  { source: '- [ ]', checked: [null], urls: [], definitions: [] },
  {
    source: '- [x](u)\n\n[r]: /u',
    checked: [null],
    urls: ['u'],
    definitions: ['r'],
  },
  {
    source: '- [x][]\n\n[x]: /u',
    checked: [null],
    urls: ['/u'],
    definitions: ['x'],
  },
  {
    source: '- [x][r][z]\n\n[r]: /u\n[z]: /v',
    checked: [null],
    urls: ['/u', '/v'],
    definitions: ['r', 'z'],
  },
  {
    source: '[r]: /u\n\n- [x][r]',
    checked: [null],
    urls: ['/u'],
    definitions: ['r'],
  },
  {
    source: '- [x][r]\n\n[r]: /u\n[r]: /v',
    checked: [null],
    urls: ['/u'],
    definitions: ['r', 'r'],
  },
  {
    source: '- [x]z\n\n[r]: /u',
    checked: [null],
    urls: [],
    definitions: ['r'],
  },
  { source: '- [x]z\n\n  later', checked: [null], urls: [], definitions: [] },
  {
    source: '- [x][r]\n  continuation\n\n[r]: /u',
    checked: [null],
    urls: ['/u'],
    definitions: ['r'],
  },
  {
    source: '- [x][`a\n\tb`]\n\n[`a b`]: /u',
    checked: [null],
    urls: ['/u'],
    definitions: ['`a b`'],
  },
]

function verifyBoundary(row: Boundary, source: string, math: boolean): void {
  const document = new MarkdownDocument({ gfm: true, math })
  try {
    document.setText(source)
    const views = read(document, source)
    compareFresh(document, source, math)
    for (const view of [views.exact, views.ended]) {
      const nodes = walk(view.root)
      assert.deepEqual(urls(view.root), row.urls)
      assert.deepEqual(
        nodes
          .filter((node) => node.type === 'listItem')
          .map((node) => node.checked),
        row.checked,
      )
      assert.deepEqual(
        nodes
          .filter((node) => node.type === 'definition')
          .map((node) => node.identifier),
        row.definitions,
      )
    }
  } finally {
    document.dispose()
  }
}

function verifyBoundaries(ending: string, math: boolean): void {
  for (const row of boundaries)
    verifyBoundary(row, row.source.replaceAll('\n', ending), math)
}

for (const ending of ['\n', '\r\n', '\r']) {
  for (const math of [false, true]) {
    test(`task and reference boundaries ${JSON.stringify(ending)} math=${math}`, () =>
      verifyBoundaries(ending, math))
  }
}

function compareFresh(
  document: MarkdownDocument,
  source: string,
  math: boolean,
): void {
  const fresh = new MarkdownDocument({ gfm: true, math })
  try {
    fresh.setText(source)
    assert.deepEqual(read(document, source), read(fresh, source))
  } finally {
    fresh.dispose()
  }
}

function lifecycle(source: string, math: boolean): void {
  const document = new MarkdownDocument({ gfm: true, math })
  const split = source.indexOf('\n\n')
  const pending = source.slice(0, split)
  const prefix = '漢😀 lead\n\n'.repeat(64)
  let retained: ReturnType<typeof read> | undefined
  let saved = ''
  try {
    document.setText(pending)
    compareFresh(document, pending, math)
    document.edit(pending.length, pending.length, source.slice(split))
    compareFresh(document, source, math)
    retained = read(document, source)
    saved = JSON.stringify(retained)
    document.reparse()
    assert.deepEqual(read(document, source), retained)
    document.edit(0, 0, prefix)
    compareFresh(document, prefix + source, math)
    document.edit(0, prefix.length, '')
    compareFresh(document, source, math)
    assert.deepEqual(read(document, source), retained)
    document.setText('replacement')
  } finally {
    document.dispose()
  }
  assert.equal(JSON.stringify(retained), saved)
}

for (const math of [false, true]) {
  test(`task/reference stream edit undo growth and retained snapshots math=${math}`, () => {
    lifecycle('- [x][`a\n\tb`]\n\n[`a b`]: /u', math)
    lifecycle('- [x] [r]\n\n[r]: /u', math)
    lifecycle('- [`a\n\tb`][r]\n\n[r]: /u', math)
  })
}

function verifyCodeMap(math: boolean): void {
  const document = new MarkdownDocument({ gfm: true, math })
  const source = '- [`a\n\tb`][r]\n\n[r]: /u'
  try {
    document.setText(source)
    for (const view of Object.values(read(document, source))) {
      assert.deepEqual(
        walk(view.root).filter((node) => node.type === 'code'),
        [
          {
            type: 'code',
            range: { start: 3, end: 9 },
            value: 'a   b',
            sourceValue: 'a\n  b',
            sourceMap: {
              value: 'a\n  b',
              tokenLength: 6,
              runs: [
                { kind: 'copy', valueStart: 0, length: 2, tokenOffset: 1 },
                {
                  kind: 'atom',
                  valueStart: 2,
                  valueLength: 2,
                  tokenOffset: 3,
                  sourceLength: 1,
                },
                { kind: 'copy', valueStart: 4, length: 1, tokenOffset: 4 },
              ],
            },
          },
        ],
      )
    }
  } finally {
    document.dispose()
  }
}

for (const math of [false, true])
  test(`reference code keeps tab contribution map math=${math}`, () =>
    verifyCodeMap(math))
