<h1 align="center">tree-sitter-md</h1>
<p align="center">Markdown for editors and chat UIs: a tree-sitter block grammar and a CommonMark and GFM inline resolver that run inside one tree-sitter runtime.</p>
<p align="center">
  <a href="https://github.com/ShaulLavo/tree-sitter-md/actions/workflows/check.yml"><img src="https://github.com/ShaulLavo/tree-sitter-md/actions/workflows/check.yml/badge.svg" alt="Parser release gates" /></a>
  <a href="https://github.com/ShaulLavo/tree-sitter-md/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
  <a href="#status"><img src="https://img.shields.io/badge/status-pre--1.0-orange" alt="Pre-1.0" /></a>
</p>
<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/guides/stream-a-chat-reply.md">Guides</a> ·
  <a href="https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/syntax.md">Reference</a> ·
  <a href="https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/performance.md">Performance</a> ·
  <a href="https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/troubleshooting.md">Troubleshooting</a>
</p>

Feed it Markdown as it arrives, one keystroke or one model token at a time, and read back what the text means so far. An unclosed `**` already renders as bold, a half-typed link is a pending link, and a reference definition that shows up later fixes the link above it.

Real output, for a reply that arrives in three chunks (`presentation({ input: 'open' })` after each one):

| Received so far | Paragraph tree |
| --- | --- |
| `Use **bold` | `text "Use "`, `strong(text "bold")` |
| `Use **bold text** and [a lin` | `text "Use "`, `strong(text "bold text")`, `text " and "`, `pendingLink(text "a lin")` |
| `Use **bold text** and [a link](https://example.com).` | `text "Use "`, `strong(text "bold text")`, `text " and "`, `link(text "a link")`, `text "."` |

## Why

- **Cheap edits.** On an Apple M1, typing in a 1 MB document costs a median 0.66 ms per keystroke, including decorations for the 60 rows around the edit. lezer, in the same process on the same edits, took 0.95 ms. Numbers and method: [Performance](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/performance.md).
- **Two kinds of reader, one parse.** Editors get flat records for the rows on screen: decorations, highlights, folds, fence injections. Renderers get a complete tree with decoded text, resolved links and source ranges. Chat UIs get the `open` and `ended` views above.
- **Checked against references.** All 676 CommonMark 0.31.2 and GFM examples match micromark, 183 of 183 chat messages and 489 of 497 repository documents match, and an incremental edit equals a fresh parse in 11,300 fuzzed edits. See [Supported syntax](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/syntax.md#conformance).
- **The price.** It needs a [tree-sitter-x](https://github.com/ShaulLavo/tree-sitter-x) runtime and Node 26 or later. Three `.wasm` files and the wrapper add 159,858 bytes gzip, and the host runtime adds 113,758.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ShaulLavo/tree-sitter-md/main/docs/assets/architecture.dark.svg">
  <img alt="The app calls MarkdownDocument. Edits go to the block grammar, which hands leaf blocks to the inline resolver. Both run inside one tree-sitter-x runtime with one shared WebAssembly memory. The resolver returns records, semantics() trees and presentation() trees." src="https://raw.githubusercontent.com/ShaulLavo/tree-sitter-md/main/docs/assets/architecture.light.svg">
</picture>

*An edit reparses blocks incrementally. Only the leaf blocks you read get inline resolution.*

## Quick start

You need Node 26 or later (Bun 1.4.4 also works). Install from Git, because npm has no current version of the package.

The package needs `web-tree-sitter` `^0.28.1`, and npm only has up to 0.27.1. The stock build also lacks the `heap` and `loadExtension` exports the resolver uses. So you install [tree-sitter-x](https://github.com/ShaulLavo/tree-sitter-x), a fork that has them, from Git under the name `web-tree-sitter`. The command in step 1 does both. Details: [Compatibility and limits](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/compatibility.md#host-runtime).

1. Create a project and install both packages.

```sh
mkdir try-md && cd try-md
npm init -y && npm pkg set type=module
npm install github:ShaulLavo/tree-sitter-md#main web-tree-sitter@github:ShaulLavo/tree-sitter-x#aab7db1518c19f61c1b13ec3f832b881cf5f1385
```

2. Save this as `stream.mjs`.

```js
import { init, MarkdownDocument } from 'tree-sitter-md'

await init()
const doc = new MarkdownDocument({ gfm: true, math: true })

const show = (node) => {
	if (node.children) return `${node.type}(${node.children.map(show).join(', ')})`
	return node.value === undefined ? node.type : `${node.type} ${JSON.stringify(node.value)}`
}

let length = 0
for (const chunk of ['Use **bold', ' text** and [a lin', 'k](https://example.com).']) {
	doc.edit(length, length, chunk)
	length += chunk.length
	console.log(show(doc.presentation({ input: 'open' }).root.children[0]))
}
doc.dispose()
```

3. Run it.

```sh
node stream.mjs
```

```text
paragraph(text "Use ", strong(text "bold"))
paragraph(text "Use ", strong(text "bold text"), text " and ", pendingLink(text "a lin"))
paragraph(text "Use ", strong(text "bold text"), text " and ", link(text "a link"), text ".")
```

If `init()` fails with `does not provide an export named 'heap'`, a stock `web-tree-sitter` won. See [Troubleshooting](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/troubleshooting.md).

## What you can do

| Task | Guide |
| --- | --- |
| Highlight and fold Markdown in an editor | [How to highlight and fold Markdown in an editor](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/guides/highlight-an-editor.md) |
| Render a document to HTML or another view | [How to render a document from `semantics()`](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/guides/render-a-document.md) |
| Render a streaming chat reply | [How to render a streaming chat reply](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/guides/stream-a-chat-reply.md) |
| Use only the block grammar, in JavaScript or C | [How to use the block grammar in another tree-sitter host](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/guides/use-the-grammar-alone.md) |

## How it works

A tree-sitter grammar finds the blocks: headings, lists, quotes, fences, tables. It tokenizes one line at a time, so an edit reparses only what it touched. A resolver written in C, built on cmark 0.31.2's inline pass, runs inside the same tree-sitter runtime and memory. It resolves emphasis, links, code spans and GFM autolinks for the leaf blocks you ask about, and caches each result by a hash of the leaf's text. Reference definitions are document-wide, and a change to one drops only the cached leaves that looked it up. Read [How tree-sitter-md works](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/concepts/architecture.md).

## Docs

- Guides: the four above.
- Concepts: [How tree-sitter-md works](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/concepts/architecture.md)
- Reference: [Supported syntax](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/syntax.md) · [Node types and record kinds](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/node-types.md) · [API](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/api.md) · [Snapshots](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/snapshots.md) · [Source fidelity](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/source-fidelity.md) · [CHAT profile](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/chat-profile.md) · [Compatibility and limits](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/compatibility.md) · [Performance](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/performance.md) · [Source provenance](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/provenance.md)
- [Troubleshooting](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/troubleshooting.md)
- Decisions: [001](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/adr/001-block-grammar-one-token-per-line.md) · [002](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/adr/002-c-inline-resolver-from-cmark.md) · [003](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/adr/003-resolver-as-a-tree-sitter-x-extension.md) · [004](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/adr/004-chat-profile-as-a-separate-grammar.md)
- [Changelog](https://github.com/ShaulLavo/tree-sitter-md/blob/main/CHANGELOG.md) · [Development](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/development.md)

## Status

Pre-1.0, at 0.1.32 in `package.json`. Expect changes between 0.1.x releases.

- **npm.** `tree-sitter-md` on npm has only 0.1.0 and 0.1.1, both from 2026-09-28. 0.1.1 has no `semantics()`, no `presentation()`, no CHAT grammar and no `cjk` or `math` options. Install from Git as above.
- **Runtimes.** Tested on Node 26, Bun 1.4.4 and Chromium 153. Node 24 fails at `init()`. Firefox and WebKit are not tested. See [Compatibility and limits](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/compatibility.md).
- **Host runtime.** Stock `web-tree-sitter` does not work. You need the tree-sitter-x build.
- **Syntax limits.** Containers nest to 200. Single-dollar math is not supported. Raw HTML is kept as data and you sanitize it. Eight repository documents differ from micromark's construct lists, and 16 GFM spec examples differ in rendered output, each pinned by hash in the tests.
- **Not measured.** Rendering time and Firefox or WebKit performance. Performance numbers come from one Apple M1 on a shared machine.

## License and contributing

MIT. See [LICENSE](https://github.com/ShaulLavo/tree-sitter-md/blob/main/LICENSE) and [NOTICE.md](https://github.com/ShaulLavo/tree-sitter-md/blob/main/NOTICE.md). To change the code, start with [Development](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/development.md).
