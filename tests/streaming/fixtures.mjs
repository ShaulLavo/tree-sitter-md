const range = (start, end) => ({ start, end })
const node = (type, start, end, fields = {}) => ({ type, range: range(start, end), ...fields })
const text = (value, start, end) => node('text', start, end, { value })
const paragraph = (start, end, children) => node('paragraph', start, end, { children })
const strong = (start, end, children) => node('strong', start, end, { children })
const emphasis = (start, end, children) => node('emphasis', start, end, { children })
const quote = (start, end, children) => node('quote', start, end, { children })
const item = (start, end, children, checked = null) => node('listItem', start, end, { spread: false, checked, children })
const list = (start, end, items) => node('list', start, end, { ordered: false, start: null, spread: false, items })
const code = (start, end, value, language = null) => node('code', start, end, { value, language, meta: null, fence: 'open' })
const link = (start, end, children, url) => node('link', start, end, { children, url, title: null, origin: 'markdown' })
const autolink = (start, end, children, url) => node('link', start, end, { children, url, title: null, origin: 'gfm-autolink', sourceUrl: url, sourceValue: url })
const definition = (start, end, identifier, url) => node('definition', start, end, { identifier, url, title: null })
const provisional = (path, reason) => ({ path, reason })
const inlinePath = ['children', 0, 'children', 0]
const options = { gfm: true, cjk: true, math: true }

function observation(end, children, metadata = {}) {
  return { root: node('root', 0, end, { children }), provisional: [], suppressed: [], references: [], ...metadata }
}

function checkpoint(id, at, input, expected) {
  return { id, at, input, expected }
}

function fixture(id, behaviors, source, exactChildren, live = {}, extra = {}) {
  const { children = exactChildren, ...metadata } = live
  const exact = observation(source.length, exactChildren, extra.endedMetadata)
  const open = observation(source.length, children, metadata)
  const { checkpoints = [], endedMetadata, ...fields } = extra
  return {
    id, behaviors, source, options, attribution: 'original',
    schedules: ['whole', 'codepoint', 'utf16', 'midpoint'],
    checkpoints: checkpoints.concat([
      checkpoint('final-open', source.length, 'open', open),
      checkpoint('final-ended', source.length, 'ended', exact),
    ]),
    ...fields,
  }
}

const nestedSource = '**outside *inside'
const nestedExact = [paragraph(0, 17, [text('**outside *inside', 0, 17)])]
const nestedLive = [paragraph(0, 17, [strong(0, 17, [text('outside ', 2, 10), emphasis(10, 17, [text('inside', 11, 17)])])])]
const lateSource = '[late][id]\n\nTail\n\n[id]: https://example.com\n'
const lateEnd = lateSource.length
const lateChildren = [
  paragraph(0, 10, [link(0, 10, [text('late', 1, 5)], 'https://example.com')]),
  paragraph(12, 16, [text('Tail', 12, 16)]),
  definition(18, lateEnd - 1, 'id', 'https://example.com'),
]
const lateUse = (resolution) => [{ kind: 'link', identifier: 'id', range: range(0, 10), resolution }]
const tableSource = '| a | b |\n| --- | --- |\n| c | d |'
const tableEnd = tableSource.length
const cell = (value, start, end) => node('tableCell', start, end, { children: [text(value, start, end)] })
const table = node('table', 0, tableEnd, { align: [null, null], rows: [
  node('tableRow', 0, 9, { cells: [cell('a', 2, 3), cell('b', 6, 7)] }),
  node('tableRow', 24, tableEnd, { cells: [cell('c', 26, 27), cell('d', 30, 31)] }),
] })

export default {
  schemaVersion: 2,
  baseline: {
    parserCommit: '38adefdfb4dca6cd5f67bebf01939250b9cffd97',
    runtimeCommit: 'aab7db1518c19f61c1b13ec3f832b881cf5f1385',
    packageVersion: '0.1.6',
  },
  references: [
    { id: 'streamdown', url: 'https://github.com/vercel/streamdown', revision: '4c55fad1bb739fba788b1f55bbe878983243edf0', license: 'Apache-2.0', evidence: 'packages/remend: nested delimiter and unfinished syntax source inspection; fixtures below are original.' },
    { id: 'codex', url: 'https://github.com/openai/codex', revision: '6ae8b8aa7c608730d4315d59c5c081897ae02780', license: 'Apache-2.0', evidence: 'codex-rs/tui/src/streaming: revisable previews, reference reflow, and canonical terminal consolidation.' },
    { id: 'textual', url: 'https://github.com/Textualize/textual', revision: '5e5b7ef58b8c5572c13a3ff9027d756623661495', license: 'MIT', evidence: 'src/textual/widgets/_markdown.py: three-append late-reference regression reproduced by the original research probe.' },
  ],
  requiredBehaviors: [
    'ordinary-text', 'nested-emphasis', 'literal-delimiters', 'unclosed-code',
    'bare-delimiters', 'open-fence', 'pending-link', 'pending-image',
    'table-reclassification', 'bare-markers', 'setext-reclassification',
    'incomplete-html', 'pending-math', 'currency', 'references',
  ],
  fixtures: [
    fixture('ordinary-without-newline', ['ordinary-text'], 'Hello chat', [paragraph(0, 10, [text('Hello chat', 0, 10)])]),
    fixture('nested-unclosed-emphasis', ['nested-emphasis'], nestedSource, nestedExact, {
      children: nestedLive,
      provisional: [provisional(inlinePath, 'unclosed-delimiter'), provisional(inlinePath.concat(['children', 1]), 'unclosed-delimiter')],
    }, { checkpoints: [
      checkpoint('outer-open', 9, 'open', observation(9, [paragraph(0, 9, [strong(0, 9, [text('outside', 2, 9)])])], { provisional: [provisional(inlinePath, 'unclosed-delimiter')] })),
      checkpoint('outer-ended', 9, 'ended', observation(9, [paragraph(0, 9, [text('**outside', 0, 9)])])),
    ] }),
    fixture('nested-completed-emphasis', ['nested-emphasis'], '**outside *inside***', [
      paragraph(0, 20, [strong(0, 20, [text('outside ', 2, 10), emphasis(10, 18, [text('inside', 11, 17)])])]),
    ]),
    fixture('escaped-and-nonflanking-markers', ['literal-delimiters'], '\\*safe* foo_bar', [paragraph(0, 15, [text('*safe* foo_bar', 0, 15)])]),
    fixture('unclosed-code-content', ['unclosed-code'], '`x * y', [paragraph(0, 6, [text('`x * y', 0, 6)])], {
      children: [paragraph(0, 6, [node('code', 0, 6, { value: 'x * y', sourceValue: 'x * y' })])],
      provisional: [provisional(inlinePath, 'unclosed-code')],
    }),
    fixture('bare-backtick', ['bare-delimiters'], '`', [paragraph(0, 1, [text('`', 0, 1)])], {
      children: [], suppressed: [{ range: range(0, 1), reason: 'empty-trailing-marker' }],
    }),
    fixture('bare-emphasis', ['bare-delimiters'], '**', [paragraph(0, 2, [text('**', 0, 2)])], {
      children: [], suppressed: [{ range: range(0, 2), reason: 'empty-trailing-marker' }],
    }),
    fixture('open-fence-whitespace-crlf', ['open-fence'], '```txt\n  a  \r\n b  ', [code(0, 18, '  a  \n b  ', 'txt')]),
    fixture('quoted-open-fence', ['open-fence'], '> ```js\n> x', [quote(0, 11, [code(2, 11, 'x', 'js')])]),
    fixture('listed-open-fence', ['open-fence'], '- ```js\n  x', [list(0, 11, [item(0, 11, [code(2, 11, 'x', 'js')])])]),
    fixture('pending-link-label', ['pending-link'], '[par', [paragraph(0, 4, [text('[par', 0, 4)])], {
      children: [paragraph(0, 4, [node('pendingLink', 0, 4, { children: [text('par', 1, 4)] })])],
      provisional: [provisional(inlinePath, 'unclosed-link')],
    }),
    fixture('pending-link-destination', ['pending-link'], '[label](https://exa', [paragraph(0, 19, [text('[label](', 0, 8), autolink(8, 19, [text('https://exa', 8, 19)], 'https://exa')])], {
      children: [paragraph(0, 19, [node('pendingLink', 0, 19, { children: [text('label', 1, 6)] })])],
      provisional: [provisional(inlinePath, 'unclosed-link')],
    }),
    fixture('pending-image-destination', ['pending-image'], '![alt](https://exa', [paragraph(0, 18, [text('![alt](', 0, 7), autolink(7, 18, [text('https://exa', 7, 18)], 'https://exa')])], {
      children: [paragraph(0, 18, [node('pendingImage', 0, 18, { alt: 'alt' })])],
      provisional: [provisional(inlinePath, 'unclosed-image')],
    }),
    fixture('incomplete-table-separator', ['table-reclassification'], '| a | b |\n| --', [paragraph(0, 14, [
      text('| a | b |', 0, 9), node('break', 9, 10, { hard: false }), text('| --', 10, 14),
    ])]),
    fixture('table-reclassifies-paragraph', ['table-reclassification'], tableSource, [table], {}, { checkpoints: [
      checkpoint('pipe-row-open', 9, 'open', observation(9, [paragraph(0, 9, [text('| a | b |', 0, 9)])])),
      checkpoint('pipe-row-ended', 9, 'ended', observation(9, [paragraph(0, 9, [text('| a | b |', 0, 9)])])),
    ] }),
    fixture('bare-heading', ['bare-markers'], '#', [node('heading', 0, 1, { depth: 1, children: [] })], {
      children: [], suppressed: [{ range: range(0, 1), reason: 'empty-trailing-marker' }],
    }),
    fixture('bare-quote', ['bare-markers'], '>', [quote(0, 1, [])], {
      children: [], suppressed: [{ range: range(0, 1), reason: 'empty-trailing-marker' }],
    }),
    fixture('bare-list', ['bare-markers'], '-', [list(0, 1, [item(0, 1, [])])], {
      children: [], suppressed: [{ range: range(0, 1), reason: 'empty-trailing-marker' }],
    }),
    fixture('bare-task-marker', ['bare-markers'], '- [ ]', [list(0, 5, [item(0, 5, [paragraph(2, 5, [text('[ ]', 2, 5)])])])], {
      children: [], suppressed: [{ range: range(0, 5), reason: 'empty-trailing-marker' }],
    }),
    fixture('setext-reclassifies-paragraph', ['setext-reclassification'], 'Title\n---', [node('heading', 0, 9, { depth: 2, children: [text('Title', 0, 5)] })], {}, { checkpoints: [
      checkpoint('title-open', 5, 'open', observation(5, [paragraph(0, 5, [text('Title', 0, 5)])])),
      checkpoint('title-ended', 5, 'ended', observation(5, [paragraph(0, 5, [text('Title', 0, 5)])])),
    ] }),
    fixture('incomplete-html-tag', ['incomplete-html'], '<span', [paragraph(0, 5, [text('<span', 0, 5)])]),
    fixture('pending-display-math', ['pending-math'], '$$\nx * y', [node('math', 0, 8, { value: 'x * y' })], {
      children: [node('pendingMath', 0, 8, { value: 'x * y' })],
      provisional: [provisional(['children', 0], 'unclosed-math')],
    }),
    fixture('currency-remains-literal', ['currency'], 'Costs $5 today', [paragraph(0, 14, [text('Costs $5 today', 0, 14)])]),
    fixture('late-reference', ['references', 'ordinary-text'], lateSource, lateChildren, { references: lateUse('resolved') }, {
      endedMetadata: { references: lateUse('resolved') },
      replay: { id: 'textual-three-append', cuts: [12, 18, lateEnd] },
      checkpoints: [
        checkpoint('unresolved-open', 18, 'open', observation(18, [paragraph(0, 10, [text('[late][id]', 0, 10)]), paragraph(12, 16, [text('Tail', 12, 16)])], { references: lateUse('unresolved') })),
        checkpoint('unresolved-ended', 18, 'ended', observation(18, [paragraph(0, 10, [text('[late][id]', 0, 10)]), paragraph(12, 16, [text('Tail', 12, 16)])], { references: lateUse('unresolved') })),
      ],
    }),
    fixture('duplicate-reference-first-wins', ['references'], '[x][a]\n\n[a]: /first\n[a]: /second', [
      paragraph(0, 6, [link(0, 6, [text('x', 1, 2)], '/first')]),
      definition(8, 19, 'a', '/first'), definition(20, 32, 'a', '/second'),
    ], { references: [{ kind: 'link', identifier: 'a', range: range(0, 6), resolution: 'resolved' }] }, {
      endedMetadata: { references: [{ kind: 'link', identifier: 'a', range: range(0, 6), resolution: 'resolved' }] },
    }),
    fixture('late-footnote', ['references'], 'See [^a]\n\n[^a]: note', [
      paragraph(0, 8, [text('See ', 0, 4), node('footnoteReference', 4, 8, { identifier: 'a' })]),
      node('footnoteDefinition', 10, 20, { identifier: 'a', children: [paragraph(16, 20, [text('note', 16, 20)])] }),
    ], { references: [{ kind: 'footnote', identifier: 'a', range: range(4, 8), resolution: 'resolved' }] }, {
      endedMetadata: { references: [{ kind: 'footnote', identifier: 'a', range: range(4, 8), resolution: 'resolved' }] },
      checkpoints: [
        checkpoint('footnote-unresolved-open', 8, 'open', observation(8, [paragraph(0, 8, [text('See [^a]', 0, 8)])], { references: [{ kind: 'footnote', identifier: 'a', range: range(4, 8), resolution: 'unresolved' }] })),
        checkpoint('footnote-unresolved-ended', 8, 'ended', observation(8, [paragraph(0, 8, [text('See [^a]', 0, 8)])], { references: [{ kind: 'footnote', identifier: 'a', range: range(4, 8), resolution: 'unresolved' }] })),
      ],
    }),
    fixture('duplicate-footnotes-preserve-source-order', ['references'], '[^n]\n\n[^n]: One.\n\n[^N]: Two.', [
      paragraph(0, 4, [node('footnoteReference', 0, 4, { identifier: 'n' })]),
      node('footnoteDefinition', 6, 16, { identifier: 'n', children: [paragraph(12, 16, [text('One.', 12, 16)])] }),
      node('footnoteDefinition', 18, 28, { identifier: 'n', children: [paragraph(24, 28, [text('Two.', 24, 28)])] }),
    ], { references: [{ kind: 'footnote', identifier: 'n', range: range(0, 4), resolution: 'resolved' }] }, {
      endedMetadata: { references: [{ kind: 'footnote', identifier: 'n', range: range(0, 4), resolution: 'resolved' }] },
    }),
    fixture('cjk-unclosed-emphasis', ['nested-emphasis'], '**中文', [paragraph(0, 4, [text('**中文', 0, 4)])], {
      children: [paragraph(0, 4, [strong(0, 4, [text('中文', 2, 4)])])],
      provisional: [provisional(inlinePath, 'unclosed-delimiter')],
    }),
    fixture('unicode-entities-escapes', ['ordinary-text', 'literal-delimiters'], '🙂 \\*literal* &amp; שלום', [paragraph(0, 24, [text('🙂 *literal* & שלום', 0, 24)])]),
    fixture('nul-source-is-retained', ['ordinary-text'], 'a\0b', [paragraph(0, 3, [text('a\uFFFDb', 0, 3)])]),
    fixture('nested-container-emphasis-tail', ['nested-emphasis'], '> - **bold', [quote(0, 10, [list(2, 10, [item(2, 10, [paragraph(4, 10, [text('**bold', 4, 10)])])])])], {
      children: [quote(0, 10, [list(2, 10, [item(2, 10, [paragraph(4, 10, [strong(4, 10, [text('bold', 6, 10)])])])])])],
      provisional: [provisional(['children', 0, 'children', 0, 'items', 0, 'children', 0, 'children', 0], 'unclosed-delimiter')],
    }),
    fixture('completed-code-span', ['unclosed-code'], '`a * b`', [paragraph(0, 7, [node('code', 0, 7, { value: 'a * b', sourceValue: 'a * b' })])]),
    fixture('completed-link-and-image', ['pending-link', 'pending-image'], '[x](/go) ![a](/img)', [paragraph(0, 19, [
      link(0, 8, [text('x', 1, 2)], '/go'), text(' ', 8, 9), node('image', 9, 19, { alt: 'a', url: '/img', title: null }),
    ])]),
  ],
}
