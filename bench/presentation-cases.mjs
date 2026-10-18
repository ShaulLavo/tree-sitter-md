import { readFileSync } from 'node:fs'

const options = Object.freeze({ gfm: true, frontmatter: false, cjk: true, math: true })
const corpusUrl = new URL('./corpus/chat.json', import.meta.url)
const structuredSection = [
  '## A complete response\n\n',
  'Ordinary prose contains **strong text**, *emphasis*, `code`, and [a link](/target).\n\n',
  '- [x] Read the source\n- [ ] Keep the remaining work visible\n\n',
  '> A quotation with a second line.\n> The received words stay available.\n\n',
  '| Item | State |\n| :--- | ---: |\n| Parser | Ready |\n| Renderer | Next |\n\n',
  '```js\nconst answer = 42\nconsole.log(answer)\n```\n\n',
  '$$\nx^2 + y^2 = z^2\n$$\n\n',
].join('')

function sizedDocument(section, size, tail) {
  const repetitions = Math.floor((size - tail.length) / section.length)
  return section.repeat(repetitions) + 'x'.repeat(size - repetitions * section.length - tail.length) + tail
}

function chat(percentile) {
  const messages = JSON.parse(readFileSync(corpusUrl, 'utf8'))
  if (!Array.isArray(messages) || messages.length !== 183 || !messages.every(value => typeof value === 'string'))
    throw new TypeError('presentation baseline requires the committed 183-message chat corpus')
  const ordered = Array.from(messages, (source, index) => ({ source, index }))
  ordered.sort((left, right) => left.source.length - right.source.length || left.index - right.index)
  const rank = Math.floor((ordered.length - 1) * percentile)
  const selected = ordered[rank]
  return {
    source: selected.source,
    provenance: { file: 'bench/corpus/chat.json', corpusMessages: messages.length, zeroBasedIndex: selected.index, lengthRank: rank, percentile },
  }
}

function references() {
  const labels = Array.from({ length: 2048 }, (_, index) => `r${String(index).padStart(4, '0')}`)
  const uses = labels.map(label => `[${label}]`).join(' ')
  const definitions = labels.map(label => `[${label}]: /target/${label}\n`).join('')
  return { source: uses + '\n\n' + definitions + '\nAn unresolved [missing] remains visible.\n', provenance: { generated: '2048 uses followed by 2048 definitions and one unresolved use', references: labels.length } }
}

function nested() {
  const prefix = '> '.repeat(64)
  const content = [
    '## Nested response\n',
    '\n',
    '- **Strong with *emphasis* and [a link](/target)**\n',
    '- Another item with `opaque code`\n',
    '\n',
    '```text\n',
    'received text\n',
    '```\n',
    '\n',
    '**A provisional final phrase',
  ]
  return { source: content.map(line => prefix + line).join(''), provenance: { generated: '64 quote levels containing a heading, list, fence and unfinished emphasis', quoteDepth: 64 } }
}

const cases = [
  { id: 'chat-median', description: 'Median-length committed assistant message', load: () => chat(0.5) },
  { id: 'chat-p90', description: '90th-percentile-length committed assistant message', load: () => chat(0.9) },
  { id: 'chat-longest', description: 'Longest committed assistant message', load: () => chat(1) },
  { id: 'normal32k', description: '32 KiB structured response with unfinished trailing emphasis', load: () => ({ source: sizedDocument(structuredSection, 32 * 1024, '\n\n**Receiving the final phrase'), provenance: { generated: 'repeated complete structured sections, plain padding, unfinished trailing emphasis', targetUtf8Bytes: 32 * 1024 } }) },
  { id: 'structured256k', description: '256 KiB structured document', load: () => ({ source: sizedDocument(structuredSection, 256 * 1024, '\n\nThe response is complete.\n'), provenance: { generated: 'repeated complete structured sections and plain padding', targetUtf8Bytes: 256 * 1024 } }) },
  { id: 'giant-paragraph256k', description: 'One 256 KiB paragraph with dense inline markup', load: () => ({ source: sizedDocument('plain **bold** and *emphasis* with `code` and [link](/target). ', 256 * 1024, '\n'), provenance: { generated: 'one paragraph with repeated strong, emphasis, code and inline links', targetUtf8Bytes: 256 * 1024 } }) },
  { id: 'references2048', description: '2048 late reference definitions and their earlier uses', load: references },
  { id: 'nested64', description: '64 nested quote levels with mixed block and inline constructs', load: nested },
]

export function presentationCases() {
  return cases.map(({ id, description }) => ({ id, description, options }))
}

export function loadPresentationCase(id) {
  const selected = cases.find(value => value.id === id)
  if (!selected) throw new TypeError('unknown presentation baseline case: ' + id)
  return { id, description: selected.description, options, ...selected.load() }
}
