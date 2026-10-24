# API reference

The package exports `init`, `MarkdownDocument`, `memoryBytes`, `Kind` and `CAPTURES`, with types in `js/index.d.ts` and `js/semantic.d.ts`. It is an ES module. Every call except `init` is synchronous.

The package `exports` map also exposes `./tree-sitter-md.wasm`, `./tree-sitter-markdown.wasm`, `./tree-sitter-markdown-chat.wasm` and `./package.json`.

All offsets are UTF-16 code units, the units of JavaScript strings. Rows are zero-based.

## `init(options?)`

```ts
function init(options?: {
	grammar?: URL | string | Response | Promise<Response> | ArrayBuffer | ArrayBufferView | Language
	chatGrammar?: URL | string | Response | Promise<Response> | ArrayBuffer | ArrayBufferView | Language
	resolver?: URL | string | Response | Promise<Response> | ArrayBuffer | ArrayBufferView | WebAssembly.Module
}): Promise<void>
```

Loads the grammars and the resolver into the host's `web-tree-sitter` runtime. Call it once, before any `MarkdownDocument`.

| Option | Loads | Default |
| --- | --- | --- |
| `grammar` | The base block grammar. A `Language` that the host already loaded is used as is. | `../tree-sitter-markdown.wasm`, relative to `js/index.js`. |
| `chatGrammar` | The math block grammar, used by documents with `math: true`. Accepts the same inputs. | `../tree-sitter-markdown-chat.wasm`. |
| `resolver` | The inline resolver, loaded as a tree-sitter-x extension. | `../tree-sitter-md.wasm`. |

- A default `file:` URL is read with `node:fs/promises`. Any other URL is fetched.
- Repeated and concurrent calls share the first call's promise, and later options are ignored. A failed call clears that promise, so a retry runs again.
- `options` must be a plain object. Anything else throws `TypeError: tree-sitter-md: init expects { grammar, resolver }`.
- `init` calls `Parser.init()` itself. Calling `Parser.init()` first is safe.

## `new MarkdownDocument(options?)`

```ts
new MarkdownDocument(options?: { gfm?: boolean; frontmatter?: boolean; cjk?: boolean; math?: boolean })
```

Defaults are `gfm: true`, `frontmatter: false`, `cjk: false`, `math: false`. See [Supported syntax](syntax.md#options). The options are fixed for the life of the document. A document with `math: true` parses with the math grammar. Documents do not share parser state.

The constructor throws `Error: tree-sitter-md: call init() first` before `init` has resolved.

### Text

| Member | Behavior |
| --- | --- |
| `setText(text)` | Replaces the whole text and parses it. Throws `TypeError` if `text` is not a string. |
| `edit(start, oldEnd, inserted)` | Replaces `[start, oldEnd)` with `inserted`, then reparses incrementally. Throws `TypeError` unless both offsets are safe integers with `0 <= start <= oldEnd <= length` and `inserted` is a string. The first `edit` on a new empty document needs no `setText`. |
| `reparse()` | Reparses unchanged text. Call it once in idle time after `setText` so the first `edit` stays cheap. |
| `lineCount` | Number of rows. |
| `rowStart(row)` | Offset of the first code unit of `row`. |

`setText` and `edit` each advance the document `revision` by one. Received text keeps NUL, BOM, CRLF and lone surrogate units. They are separate from the normalization the parser applies internally.

### Records for editors

All four return a new `Uint32Array` that the caller owns. The layout of each record is in [Node types and record kinds](node-types.md).

| Member | Returns |
| --- | --- |
| `decorations(from, to)` | `[start, end, kind, extra]` records for constructs that intersect `[from, to)`. |
| `decorationsForRows(fromRow, toRow)` | The same, for rows `[fromRow, toRow)`. |
| `highlights(from, to)` | `[start, end, capture]` triples, sorted. |
| `folds(from, to)` | `[start, end]` pairs. |
| `injections(from, to)` | `[contentStart, contentEnd, languageStart, languageEnd]` quads. |

Inline constructs resolve lazily, only for the leaf blocks that intersect the requested range. Results for unchanged leaves come from a cache.

### Snapshots for renderers

| Member | Returns |
| --- | --- |
| `semantics()` | A `SemanticSnapshot`: the exact tree of the complete document. |
| `presentation({ input })` | A `PresentationSnapshot`. `input` is `'open'` (more text may follow) or `'ended'`. Any other value throws `TypeError: tree-sitter-md: presentation expects { input: open \| ended }`. |

Both materialize the whole document, so they cost more than a viewport read. A snapshot is owned. It stays valid after later edits, memory growth and `dispose()`. The types and field meanings are in [Snapshots](snapshots.md).

### Lifetime

`dispose()` frees the native document. It is idempotent. Any other member throws `TypeError: tree-sitter-md: document is disposed` afterwards.

## `memoryBytes()`

Returns the byte length of the shared tree-sitter memory, or 0 before `init`. WebAssembly memory only grows. Disposing documents makes their allocations reusable but does not shrink it.

## `Kind` and `CAPTURES`

Plain data, documented in [Node types and record kinds](node-types.md). Both are frozen.
