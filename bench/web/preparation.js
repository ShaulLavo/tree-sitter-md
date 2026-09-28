import { init, MarkdownDocument, memoryBytes } from '/js/index.js'

const percentile = (values, p) => values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * p)]
const time = (run) => {
  const start = performance.now()
  run()
  return performance.now() - start
}
const methods = ['decorations', 'highlights', 'folds', 'injections']

function assertEqual(a, b) {
  if (a.length !== b.length || a.some((value, i) => value !== b[i])) {
    throw new Error('incremental output differs from fresh output')
  }
}

function visible(doc, from, to) {
  for (const method of methods) doc[method](from, to)
}

function measureEdits(doc, source, at) {
  let text = source
  const samples = []
  for (let i = 0; i < 80; i++) {
    const start = performance.now()
    doc.edit(at, at, 'x')
    visible(doc, Math.max(0, at - 1000), Math.min(text.length + 1, at + 3000))
    samples.push(performance.now() - start)
    text = text.slice(0, at) + 'x' + text.slice(at)
  }
  const fresh = new MarkdownDocument()
  try {
    fresh.setText(text)
    for (const method of methods) assertEqual(doc[method](0, text.length), fresh[method](0, text.length))
  } finally {
    fresh.dispose()
  }
  return { first: samples[0], median: percentile(samples.slice(5), 0.5), p95: percentile(samples.slice(5), 0.95) }
}

function retainedMemory(text) {
  const docs = []
  const before = memoryBytes()
  try {
    for (let i = 0; i < 8; i++) {
      const doc = new MarkdownDocument()
      docs.push(doc)
      doc.setText(text)
      visible(doc, 0, Math.min(6000, text.length))
    }
    return { documents: docs.length, reservedHeapGrowth: memoryBytes() - before }
  } finally {
    for (const doc of docs) doc.dispose()
  }
}

window.measurePreparation = async (text) => {
  const started = performance.now()
  await init({ grammar: '/tree-sitter-markdown.wasm', resolver: '/tree-sitter-md.wasm' })
  const load = performance.now() - started
  const doc = new MarkdownDocument()
  const at = Math.max(0, text.indexOf('text', Math.floor(text.length / 2)))
  try {
    const fullParse = time(() => doc.setText(text))
    const visibleStart = time(() => visible(doc, 0, Math.min(6000, text.length)))
    const restoredVisible = time(() => visible(doc, at, Math.min(text.length, at + 6000)))
    const withoutIdle = measureEdits(doc, text, at)
    const warmParse = time(() => doc.setText(text))
    const idleReparse = time(() => doc.reparse())
    const withIdle = measureEdits(doc, text, at)
    return { chars: text.length, load, fullParse, visibleStart, restoredVisible, warmParse, idleReparse, withoutIdle, withIdle, memory: retainedMemory(text) }
  } finally {
    doc.dispose()
  }
}
