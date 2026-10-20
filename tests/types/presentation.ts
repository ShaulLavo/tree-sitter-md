import { MarkdownDocument } from '../../js/index.js'
import type {
  PresentationBlock, PresentationInline, PresentationInput, PresentationRoot,
  PresentationSnapshot, SemanticInline, SemanticRoot,
} from '../../js/index.js'

const range = { start: 0, end: 5 }
const pendingImage: PresentationInline = { type: 'pendingImage', range, alt: 'hello' }
const pendingLink: PresentationInline = { type: 'pendingLink', range, children: [pendingImage] }
const nested: PresentationBlock = {
  type: 'quote', range, children: [{
    type: 'list', range, ordered: false, start: null, spread: false,
    items: [{ type: 'listItem', range, spread: false, checked: null, children: [{
      type: 'paragraph', range, children: [{ type: 'strong', range, children: [pendingLink] }],
    }] }],
  }],
}
const pendingMath: PresentationBlock = { type: 'pendingMath', range, value: 'hello', meta: null }
const inlineMath: PresentationInline = { type: 'pendingMath', range, value: 'hello' }
const root: PresentationRoot = { type: 'root', range, children: [nested, pendingMath] }
// @ts-expect-error Open presentation trees can contain pending nodes.
const exactRoot: SemanticRoot = root
// @ts-expect-error Exact inline nodes exclude pending images.
const exactInline: SemanticInline = pendingImage
// @ts-expect-error Pending links have no destination.
pendingLink.url
// @ts-expect-error Pending images have no destination.
pendingImage.url
// @ts-expect-error Pending images cannot invent a destination.
const inventedImage: PresentationInline = { type: 'pendingImage', range, alt: '', url: '/guess' }
// @ts-expect-error Pending math is readonly.
inlineMath.value = 'changed'

function destination(node: PresentationInline): string {
  if (node.type === 'link' || node.type === 'image') return node.url
  return ''
}

const document = new MarkdownDocument()
const open = document.presentation({ input: 'open' })
const ended = document.presentation({ input: 'ended' })
const openInput: 'open' = open.input
const endedInput: 'ended' = ended.input
const finalRoot: SemanticRoot = ended.root
const emptyProvisional: readonly [] = ended.provisional
const emptySuppressed: readonly [] = ended.suppressed
// @ts-expect-error Open snapshots cannot be used as exact semantic roots.
const openExact: SemanticRoot = open.root
// @ts-expect-error Ended snapshots cannot contain provisional nodes.
ended.provisional.push({ path: ['children', 0], reason: 'incomplete' })
// @ts-expect-error Snapshot source is readonly.
open.source = 'changed'
// @ts-expect-error Child arrays are readonly.
open.root.children.push(pendingMath)
// @ts-expect-error Invalid input modes are rejected by the public API.
document.presentation({ input: 'paused' })

declare const input: PresentationInput
const selected: PresentationSnapshot = document.presentation({ input })
if (selected.input === 'ended') {
  const narrowed: SemanticRoot = selected.root
  const empty: readonly [] = selected.provisional
}

const sourceCode: SemanticInline = {
  type: 'code', range: { start: 0, end: 6 }, value: 'a b', sourceValue: 'a\n b',
  sourceMap: { value: 'a\n b', tokenLength: 6, runs: [{ kind: 'copy', valueStart: 0, length: 4, tokenOffset: 1 }] },
}
type CodeMap = Extract<SemanticInline, { type: 'code' }>['sourceMap']
const atomMap: CodeMap = { value: '|', tokenLength: 4, runs: [{ kind: 'atom', valueStart: 0, valueLength: 1, tokenOffset: 1, sourceLength: 2 }] }
// @ts-expect-error Inline code requires its producer map.
const missingMap: SemanticInline = { type: 'code', range, value: 'a', sourceValue: 'a' }
// @ts-expect-error Source maps are readonly.
sourceCode.sourceMap.tokenLength = 9
// @ts-expect-error Contribution arrays are readonly.
atomMap.runs.push({ kind: 'copy', valueStart: 0, length: 1, tokenOffset: 1 })
// @ts-expect-error Atoms require their local source contribution length.
const incompleteAtom: CodeMap = { value: '|', tokenLength: 4, runs: [{ kind: 'atom', valueStart: 0, valueLength: 1, tokenOffset: 1 }] }
function contributionLength(run: CodeMap['runs'][number]): number {
  if (run.kind === 'copy') return run.length
  return run.sourceLength
}
const sourceLink: SemanticInline = {
  type: 'link', range, origin: 'gfm-autolink', url: 'https://a/?x&y', title: null,
  sourceUrl: 'https://a/?x&amp;y', sourceValue: 'https://a/?x&amp;y', children: [],
}
const angleLink: PresentationInline = {
  type: 'link', range, origin: 'autolink', url: 'https://a/', title: null, children: [],
}
// @ts-expect-error Inline code must expose its source-faithful value.
const missingSource: SemanticInline = { type: 'code', range, value: 'a b' }
// @ts-expect-error GFM autolinks must expose both literal source fields.
const missingGfmSource: SemanticInline = { type: 'link', range, origin: 'gfm-autolink', url: '', title: null, children: [] }
// @ts-expect-error Every completed link identifies its parsing origin.
const missingOrigin: PresentationInline = { type: 'link', range, url: '', title: null, children: [] }
function literalValue(node: PresentationInline): string {
  if (node.type === 'code') return node.sourceValue
  if (node.type === 'link' && node.origin === 'gfm-autolink') return node.sourceValue
  return ''
}
// @ts-expect-error Markdown and angle links do not claim GFM source metadata.
angleLink.sourceUrl
