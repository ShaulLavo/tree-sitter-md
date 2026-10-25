# Troubleshooting

The failures people hit first, each reproduced against this repository.

## `does not provide an export named 'heap'`

```text
SyntaxError: The requested module 'web-tree-sitter' does not provide an export named 'heap'
```

Your project is running regular tree-sitter, the `web-tree-sitter` package from npm, instead of tree-sitter-x. tree-sitter-md needs tree-sitter-x, which exports `heap` and `loadExtension`. Regular tree-sitter 0.26.9 and 0.27.1 both fail this way.

1. Run `npm ls web-tree-sitter` and find which package pulled the regular build.
2. Install the pinned build and force it with `overrides`. See [Compatibility](reference/compatibility.md#host-runtime) for the exact `package.json`.

The block grammar alone does not need tree-sitter-x. See [How to use the block grammar in another tree-sitter host](guides/use-the-grammar-alone.md).

## `call init() first`

```text
Error: tree-sitter-md: call init() first
```

`new MarkdownDocument()` ran before `init()` resolved. `await init()` once at startup, before you create documents.

## `document is disposed`

```text
TypeError: tree-sitter-md: document is disposed
```

You called a method after `dispose()`. Create a new `MarkdownDocument` instead. Snapshots from `semantics()` and `presentation()` stay valid after disposal, so read them before you dispose or keep them.

## `edit requires a valid UTF-16 range and string`

```text
TypeError: tree-sitter-md: edit requires a valid UTF-16 range and string
```

`edit(start, oldEnd, inserted)` needs safe integers with `0 <= start <= oldEnd <= length`, where `length` is the current text length in UTF-16 code units. Common causes:

- You passed byte offsets or code point indexes. Use JavaScript string indexes.
- You applied an earlier edit to your own text but not to the document, or the reverse. Send every change, in order.
- `inserted` is not a string.

## The wasm files return 404 in Vite

`init()` resolves the default `.wasm` URLs relative to `js/index.js`, and the host runtime resolves its own `.wasm` the same way. Vite's dependency pre-bundling moves those files, so the URLs stop resolving. Import each file as a URL and pass it in. This is the setup that `bun run test:package` builds with Vite and runs in Chromium:

```ts
import { Parser } from 'web-tree-sitter'
import host from 'web-tree-sitter/web-tree-sitter.wasm?url'
import grammar from 'tree-sitter-md/tree-sitter-markdown.wasm?url'
import mathGrammar from 'tree-sitter-md/tree-sitter-markdown-math.wasm?url'
import resolver from 'tree-sitter-md/tree-sitter-md.wasm?url'
import { init } from 'tree-sitter-md'

await Parser.init({ locateFile: () => host })
await init({ grammar, mathGrammar, resolver })
```

A production build prints a warning that `node:fs/promises` was externalized. The browser path never reaches that import, and the Chromium test passes with the warning. It fetches four `.wasm` files: these three and the host runtime's.

## A reference link or footnote does not render

Reference links resolve against definitions anywhere in the document. If `[label]` stays text, check that a `[label]: url` line exists, that the label is at most 999 characters, and that you did not set `gfm: false` for footnotes. In a streaming reply the definition may not have arrived yet. An `'open'` presentation reports the use as `unresolved` in `references` and resolves it on the read after the definition arrives.

## A table, strikethrough or `www.` link stays text

`gfm` is on by default. If you passed `{ gfm: false }`, these are plain text. See [Supported syntax](reference/syntax.md#options).
