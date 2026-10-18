const options = { gfm: true, cjk: true, math: true }

export const lifetimeFixtures = [
  { id: 'ordinary', source: 'ordinary 😀 prose', suffix: ' continued' },
  { id: 'nested-delimiters', source: '**outside *inside', suffix: '* outside**' },
  { id: 'pending-link', source: '[label](https://exa', suffix: 'mple.test/path)' },
  { id: 'pending-image', source: '![alt](https://exa', suffix: 'mple.test/image.png)' },
  { id: 'code-span', source: '`a **opaque', suffix: '`' },
  { id: 'bare-delimiter', source: '**', suffix: 'received**' },
  { id: 'empty-task', source: '> - [ ]', suffix: ' task' },
  { id: 'nested-fence', source: '> - ```js\n>   const x = 1', suffix: '\n>   ```' },
  { id: 'math', source: '$$x *a*', suffix: '\n$$' },
  { id: 'table-candidate', source: 'a | b\n-- |', suffix: ' --\nx | y' },
  { id: 'late-reference', source: '[late][id]\n\nTail', suffix: '\n\n[id]: /target' },
  { id: 'late-footnote', source: '[^n]\n\nTail', suffix: '\n\n[^n]: note' },
  { id: 'cjk-delimiter', source: '中**文', suffix: '**' },
  { id: 'unfinished-html', source: '<section data-x="abc', suffix: '">body</section>' },
  { id: 'raw-utf16', source: '\uFEFFa\0\uFFFD\r\n\uD83D', suffix: '\uDE00' },
]

const deliveryReads = [
  { event: 'received', input: 'open' },
  { event: 'pause', input: 'open' },
  { event: 'retryable-failure', input: 'open' },
  { event: 'success', input: 'ended' },
  { event: 'cancellation', input: 'ended' },
  { event: 'permanent-failure', input: 'ended' },
  { event: 'reopen', input: 'open' },
  { event: 'pause-again', input: 'open' },
  { event: 'ended-again', input: 'ended' },
]

export const lifetimeBounds = {
  fixtures: lifetimeFixtures.length,
  deliveryReadsPerFixture: deliveryReads.length,
  terminalReasons: ['success', 'cancellation', 'permanent-failure'],
  containerDepths: [199, 200, 201, 256],
  simultaneousDocuments: 64,
}

function observation(result) {
  const { revision, ...value } = result
  return value
}

function exactObservation(result) {
  return { root: result.root, profile: result.profile, capabilities: result.capabilities }
}

function retainedResult(document, input) {
  const result = document.presentation({ input })
  return { result, text: JSON.stringify(result) }
}

function verifyRetained(retained, equal, label) {
  for (const saved of retained) equal(JSON.stringify(saved.result), saved.text, `${label}: retained snapshot changed`)
}

function verifyPair(document, source, fresh, equal, label) {
  fresh.setText(source)
  const semantic = document.semantics()
  equal(exactObservation(semantic), exactObservation(fresh.semantics()), `${label}: exact tree differs from fresh`)
  for (const input of ['open', 'ended']) {
    const actual = document.presentation({ input })
    equal(actual.source, source, `${label}: raw UTF-16 source changed`)
    equal(actual.revision, semantic.revision, `${label}: read changed source revision`)
    equal(observation(actual), observation(fresh.presentation({ input })), `${label}: complete ${input} snapshot differs from fresh`)
  }
  const ended = document.presentation({ input: 'ended' })
  equal(exactObservation(ended), exactObservation(semantic), `${label}: ended differs from exact semantics`)
  equal(ended.provisional, [], `${label}: ended retains provisional interpretation`)
  equal(ended.suppressed, [], `${label}: ended retains suppression`)
}

function verifyDeliveryReads(document, source, equal, label) {
  const baseline = { open: document.presentation({ input: 'open' }), ended: document.presentation({ input: 'ended' }) }
  const semantic = document.semantics()
  for (const { event, input } of deliveryReads) {
    equal(document.presentation({ input }), baseline[input], `${label}/${event}: metadata-only read changed result or revision`)
    equal(document.semantics(), semantic, `${label}/${event}: presentation contaminated exact semantics`)
  }
  equal(baseline.open.source, source, `${label}: open raw source changed`)
  equal(baseline.ended.source, source, `${label}: ended raw source changed`)
  document.reparse()
  equal(document.presentation({ input: 'open' }), baseline.open, `${label}: idle reparse changed open snapshot or revision`)
  equal(document.presentation({ input: 'ended' }), baseline.ended, `${label}: idle reparse changed ended snapshot or revision`)
  return [retainedResult(document, 'open'), retainedResult(document, 'ended')]
}

function verifyResume(document, fresh, fixture, retained, equal, reason) {
  const label = `${fixture.id}/${reason}`
  const before = document.presentation({ input: 'ended' })
  document.edit(fixture.source.length, fixture.source.length, fixture.suffix)
  equal(document.presentation({ input: 'open' }).revision, before.revision + 1, `${label}: resume edit did not advance revision once`)
  verifyPair(document, fixture.source + fixture.suffix, fresh, equal, label)
  verifyRetained(retained, equal, label)
  document.edit(fixture.source.length, fixture.source.length + fixture.suffix.length, '')
  verifyPair(document, fixture.source, fresh, equal, `${label}/undo`)
  verifyRetained(retained, equal, `${label}/undo`)
}

function verifyFixture(MarkdownDocument, fixture, equal) {
  const document = new MarkdownDocument(options)
  const fresh = new MarkdownDocument(options)
  const sibling = new MarkdownDocument({ gfm: false })
  try {
    document.setText(fixture.source)
    sibling.setText('sibling **pending\0\uD83D')
    const siblingBefore = sibling.presentation({ input: 'open' })
    const retained = verifyDeliveryReads(document, fixture.source, equal, fixture.id)
    verifyPair(document, fixture.source, fresh, equal, fixture.id)
    for (const reason of lifetimeBounds.terminalReasons) verifyResume(document, fresh, fixture, retained, equal, reason)
    const revision = document.presentation({ input: 'open' }).revision
    document.setText('\uFEFFreplacement\0\uFFFD\r\n\uDE00x\uD83D')
    equal(document.presentation({ input: 'open' }).revision, revision + 1, `${fixture.id}: replacement revision changed incorrectly`)
    verifyPair(document, '\uFEFFreplacement\0\uFFFD\r\n\uDE00x\uD83D', fresh, equal, `${fixture.id}/replacement`)
    verifyRetained(retained, equal, `${fixture.id}/replacement`)
    equal(sibling.presentation({ input: 'open' }), siblingBefore, `${fixture.id}: live sibling changed after edits`)
    document.dispose()
    document.dispose()
    verifyRetained(retained, equal, `${fixture.id}/dispose`)
    equal(sibling.presentation({ input: 'open' }), siblingBefore, `${fixture.id}: live sibling changed after repeated disposal`)
    sibling.edit(siblingBefore.source.length, siblingBefore.source.length, '**')
    equal(sibling.presentation({ input: 'ended' }).source, siblingBefore.source + '**', `${fixture.id}: live sibling failed after disposal`)
  } finally {
    document.dispose()
    fresh.dispose()
    sibling.dispose()
  }
}

function quoteCount(root) {
  let count = 0
  let node = root.children[0]
  while (node?.type === 'quote') {
    count++
    node = node.children[0]
  }
  return count
}

function verifyDepth(MarkdownDocument, depth, equal) {
  const document = new MarkdownDocument(options)
  const fresh = new MarkdownDocument(options)
  const source = '> '.repeat(depth) + '**pending'
  try {
    document.setText(source)
    const before = retainedResult(document, 'open')
    equal(quoteCount(before.result.root), Math.min(depth, 200), `depth ${depth}: native container limit changed`)
    verifyPair(document, source, fresh, equal, `depth ${depth}`)
    document.edit(source.length, source.length, '**\n\n# Tail\n')
    verifyPair(document, source + '**\n\n# Tail\n', fresh, equal, `depth ${depth}/append`)
    document.setText('recovered **pending')
    verifyPair(document, 'recovered **pending', fresh, equal, `depth ${depth}/replace`)
    document.dispose()
    equal(JSON.stringify(before.result), before.text, `depth ${depth}: retained tree changed after replacement/disposal`)
  } finally {
    document.dispose()
    fresh.dispose()
  }
}

function verifyDocumentBatch(MarkdownDocument, equal, assert) {
  const documents = []
  const retained = []
  try {
    for (let index = 0; index < lifetimeBounds.simultaneousDocuments; index++) {
      const document = new MarkdownDocument(index % 2 ? options : { gfm: false, math: true })
      documents.push(document)
      document.setText(`doc-${index} [late][id]\n\n**pending\0\uD83D`)
      retained.push(retainedResult(document, 'open'))
    }
    for (let index = 0; index < documents.length; index++) verifyBatchDocument(documents, retained, index, equal)
    for (let index = 0; index < documents.length - 1; index++) disposeBatchDocument(documents, index, equal)
    assert(documents.length === lifetimeBounds.simultaneousDocuments, 'simultaneous-document coverage is incomplete')
    verifyRetained(retained, equal, 'many documents')
  } finally {
    for (const document of documents) document.dispose()
  }
  verifyRetained(retained, equal, 'many documents after disposal')
}

function verifyBatchDocument(documents, retained, index, equal) {
  const document = documents[index]
  const neighbor = documents[(index + 1) % documents.length]
  const neighborBefore = neighbor.presentation({ input: 'open' })
  const source = retained[index].result.source
  document.edit(source.length, source.length, '\uDE00**\n\n[id]: /resolved')
  equal(document.presentation({ input: 'ended' }).root, document.semantics().root, `document ${index}: ended/exact mismatch`)
  equal(neighbor.presentation({ input: 'open' }), neighborBefore, `document ${index}: sibling changed after edit`)
}

function disposeBatchDocument(documents, index, equal) {
  const sibling = documents[documents.length - 1]
  const before = sibling.presentation({ input: 'open' })
  documents[index].dispose()
  documents[index].dispose()
  equal(sibling.presentation({ input: 'open' }), before, `document ${index}: sibling changed after repeated disposal`)
}

function verifyRawSourceEdits(MarkdownDocument, equal) {
  const document = new MarkdownDocument(options)
  const fresh = new MarkdownDocument(options)
  const edits = [[0, 0, '\uFEFFa\0\uFFFD\r\n\uD83D'], [7, 7, '\uDE00'], [6, 7, ''], [6, 6, '\uD83D'], [5, 5, 'x'], [5, 6, ''], [3, 4, '\0'], [0, 8, '']]
  const retained = []
  let source = ''
  try {
    for (const [start, end, inserted] of edits) {
      document.edit(start, end, inserted)
      source = source.slice(0, start) + inserted + source.slice(end)
      verifyPair(document, source, fresh, equal, 'raw source edit')
      retained.push(retainedResult(document, 'open'))
      verifyRetained(retained, equal, 'raw source edit')
    }
  } finally {
    document.dispose()
    fresh.dispose()
  }
  verifyRetained(retained, equal, 'raw source edits after disposal')
  return edits.length
}

export function runPresentationLifetimes({ MarkdownDocument, equal, assert }) {
  for (const fixture of lifetimeFixtures) verifyFixture(MarkdownDocument, fixture, equal)
  for (const depth of lifetimeBounds.containerDepths) verifyDepth(MarkdownDocument, depth, equal)
  verifyDocumentBatch(MarkdownDocument, equal, assert)
  const rawSourceEdits = verifyRawSourceEdits(MarkdownDocument, equal)
  return {
    fixtures: lifetimeFixtures.length,
    deliveryReads: lifetimeFixtures.length * deliveryReads.length,
    terminalResumeEdits: lifetimeFixtures.length * lifetimeBounds.terminalReasons.length,
    rawReplacementCases: lifetimeFixtures.length,
    containerDepths: lifetimeBounds.containerDepths,
    simultaneousDocuments: lifetimeBounds.simultaneousDocuments,
    rawSourceEdits,
  }
}
