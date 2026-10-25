# Project overview

Feed it Markdown as it arrives, one keystroke or one model token at a time, and read back what the text means so far. An unclosed `**` already renders as bold, a half-typed link is a pending link, and a reference definition that shows up later fixes the link above it.

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

## Status

Pre-1.0, at 0.1.32 in `package.json`. Expect changes between 0.1.x releases.

- **npm.** `tree-sitter-md` on npm has only 0.1.0 and 0.1.1, both from 2026-09-28. 0.1.1 has no `semantics()`, no `presentation()`, no math grammar and no `cjk` or `math` options. Use the [Git installation instructions](../README.md).
- **Runtimes.** Tested on Node 24, Node 26, Bun 1.4.4 and Chromium 153. Firefox and WebKit are not tested. See [Compatibility and limits](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/compatibility.md).
- **Runtime.** It needs tree-sitter-x. Stock tree-sitter is not supported, apart from the block grammar alone, which still loads there today.
- **Size.** `init()` loads all three `.wasm` files, 154,284 bytes gzip, plus the wrapper. See [Performance](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/performance.md#size).
- **Syntax limits.** Containers nest to 200. Single-dollar math is not supported. Raw HTML is kept as data and you sanitize it. Eight repository documents differ from micromark's construct lists, and 16 GFM spec examples differ in rendered output, each pinned by hash in the tests.
- **Not measured.** Rendering time and Firefox or WebKit performance. Performance numbers come from one Apple M1 on a shared machine.
