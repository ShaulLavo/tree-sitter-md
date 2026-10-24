<h1 align="center">tree-sitter-md</h1>
<p align="center">Markdown for editors and chat UIs on tree-sitter-x: a block grammar and a CommonMark and GFM inline resolver.</p>
<p align="center">
  <a href="https://github.com/ShaulLavo/tree-sitter-md/actions/workflows/check.yml"><img src="https://github.com/ShaulLavo/tree-sitter-md/actions/workflows/check.yml/badge.svg" alt="Parser release gates" /></a>
  <a href="https://github.com/ShaulLavo/tree-sitter-md/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
  <a href="#status"><img src="https://img.shields.io/badge/status-pre--1.0-orange" alt="Pre-1.0" /></a>
</p>
<p align="center">
  <a href="#install">Install</a> ·
  <a href="https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/guides/stream-a-chat-reply.md">Guides</a> ·
  <a href="https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/syntax.md">Reference</a> ·
  <a href="https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/performance.md">Performance</a> ·
  <a href="https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/troubleshooting.md">Troubleshooting</a>
</p>

> **tree-sitter-md is built for [tree-sitter-x](https://github.com/ShaulLavo/tree-sitter-x), not for stock tree-sitter.** tree-sitter-x began as a fork of the tree-sitter web runtime and will keep drifting away from it. This package follows tree-sitter-x.

Feed it Markdown as it arrives, one keystroke or one model token at a time, and read back what the text means so far. An unclosed `**` already renders as bold, a half-typed link is a pending link, and a reference definition that shows up later fixes the link above it.

## Install

```sh
npm install github:ShaulLavo/tree-sitter-md#main web-tree-sitter@github:ShaulLavo/tree-sitter-x#aab7db1518c19f61c1b13ec3f832b881cf5f1385
```

That installs tree-sitter-x under the name `web-tree-sitter`, which is the name tree-sitter-md imports. It needs Node 26 or later, or Bun 1.4.4. tree-sitter-x's runtime uses resizable WebAssembly memory, and Node 24 does not have it.

tree-sitter-md is not on npm at its current version. The two npm releases predate `semantics()`, `presentation()` and the math grammar.

## Use it

```ts
import { init, MarkdownDocument } from 'tree-sitter-md'

await init()

const doc = new MarkdownDocument()
doc.setText('# Notes\n\nSome **bold** text.\n\n- one\n- two\n')

for (const block of doc.semantics().root.children) {
	console.log(block.type)
}

doc.dispose()
```

```text
heading
paragraph
list
```

`semantics()` returns the whole document as a tree with decoded text, resolved links and source ranges. Edit it in place with `doc.edit(start, oldEnd, inserted)`, and only the changed blocks reparse.

## What you can do

- **Highlight Markdown in an editor.** [How to highlight Markdown in an editor](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/guides/highlight-an-editor.md)
- **Render a document to HTML or another view.** [How to render a document from `semantics()`](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/guides/render-a-document.md)
- **Render a streaming chat reply.** Unclosed bold renders as bold, and a half-typed link stays pending until it closes. [How to render a streaming chat reply](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/guides/stream-a-chat-reply.md)
- **Use only the block grammar.** [How to use the block grammar in another tree-sitter host](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/guides/use-the-grammar-alone.md)

## Why

- **Cheap edits.** On an Apple M1, typing in a 1 MB document costs a median 0.66 ms per keystroke, including decorations for the 60 rows around the edit. lezer, in the same process on the same edits, took 0.95 ms. Numbers and method: [Performance](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/performance.md).
- **Two kinds of reader, one parse.** Editors get flat records for the rows on screen: decorations, highlights, fence injections. Renderers get a complete tree. Chat UIs get an `open` view of a partial message and an `ended` view of a finished one.
- **Checked against references.** All 676 CommonMark 0.31.2 and GFM examples match micromark, 183 of 183 chat messages and 489 of 497 repository documents match, and an incremental edit equals a fresh parse in 11,300 fuzzed edits. See [Supported syntax](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/syntax.md#conformance).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ShaulLavo/tree-sitter-md/main/docs/assets/architecture.dark.svg">
  <img alt="The app calls MarkdownDocument. Edits go to the block grammar, which hands leaf blocks to the inline resolver. Both run inside one tree-sitter-x runtime with one shared WebAssembly memory. The resolver returns records, semantics() trees and presentation() trees." src="https://raw.githubusercontent.com/ShaulLavo/tree-sitter-md/main/docs/assets/architecture.light.svg">
</picture>

*An edit reparses blocks incrementally. Only the leaf blocks you read get inline resolution.*

## How it works

A block grammar for tree-sitter-x finds the blocks: headings, lists, quotes, fences, tables. It tokenizes one line at a time, so an edit reparses only what it touched. A resolver written in C, built on cmark 0.31.2's inline pass, runs inside the same tree-sitter runtime and memory. It resolves emphasis, links, code spans and GFM autolinks for the leaf blocks you ask about, and caches each result by a hash of the leaf's text. Reference definitions are document-wide, and a change to one drops only the cached leaves that looked it up. Read [How tree-sitter-md works](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/concepts/architecture.md).

## Docs

- Guides: the four above.
- Concepts: [How tree-sitter-md works](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/concepts/architecture.md)
- Reference: [Supported syntax](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/syntax.md) · [Node types and record kinds](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/node-types.md) · [API](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/api.md) · [Snapshots](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/snapshots.md) · [Source fidelity](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/source-fidelity.md) · [Math](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/math.md) · [Compatibility and limits](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/compatibility.md) · [Performance](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/performance.md) · [Source provenance](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/provenance.md)
- [Troubleshooting](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/troubleshooting.md)
- Decisions: [001](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/adr/001-block-grammar-one-token-per-line.md) · [002](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/adr/002-c-inline-resolver-from-cmark.md) · [003](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/adr/003-resolver-as-a-tree-sitter-x-extension.md) · [004](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/adr/004-math-as-a-separate-grammar.md)
- [Changelog](https://github.com/ShaulLavo/tree-sitter-md/blob/main/CHANGELOG.md) · [Development](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/development.md)

## Status

Pre-1.0, at 0.1.32 in `package.json`. Expect changes between 0.1.x releases.

- **npm.** `tree-sitter-md` on npm has only 0.1.0 and 0.1.1, both from 2026-09-28. 0.1.1 has no `semantics()`, no `presentation()`, no math grammar and no `cjk` or `math` options. Install from Git as above.
- **Runtimes.** Tested on Node 26, Bun 1.4.4 and Chromium 153. Node 24 fails at `init()`. Firefox and WebKit are not tested. See [Compatibility and limits](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/compatibility.md).
- **Runtime.** It needs tree-sitter-x. Stock tree-sitter is not supported, apart from the block grammar alone, which still loads there today.
- **Size.** `init()` loads all three `.wasm` files, 154,284 bytes gzip, plus the wrapper. See [Performance](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/performance.md#size).
- **Syntax limits.** Containers nest to 200. Single-dollar math is not supported. Raw HTML is kept as data and you sanitize it. Eight repository documents differ from micromark's construct lists, and 16 GFM spec examples differ in rendered output, each pinned by hash in the tests.
- **Not measured.** Rendering time and Firefox or WebKit performance. Performance numbers come from one Apple M1 on a shared machine.

## License and contributing

MIT. See [LICENSE](https://github.com/ShaulLavo/tree-sitter-md/blob/main/LICENSE) and [NOTICE.md](https://github.com/ShaulLavo/tree-sitter-md/blob/main/NOTICE.md). To change the code, start with [Development](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/development.md).
