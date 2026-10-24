# Use tree-sitter-md

```js
import { init, MarkdownDocument, Kind, CAPTURES } from 'tree-sitter-md'

await init() // or init({ grammar, chatGrammar, resolver }): URLs, bytes, Responses, or a loaded Language as grammar
const doc = new MarkdownDocument({ gfm: true, frontmatter: true })
doc.setText(text)
doc.reparse() // once, in idle time after setText: keeps the first keystroke cheap
doc.edit(start, oldEnd, 'inserted') // UTF-16 offsets, like JS strings
const records = doc.decorationsForRows(fromRow, toRow) // Uint32Array of [start, end, kind, extra]
const captures = doc.highlights(from, to) // [start, end, capture], names in CAPTURES
const folds = doc.folds(from, to) // [start, end]
const fences = doc.injections(from, to) // [contentStart, contentEnd, langStart, langEnd]
doc.dispose()
```

For renderers, `doc.semantics()` returns a complete owned tree with decoded text,
resolved links and titles, nested blocks and inlines, ordered list starts and
spacing metadata, task states, table rows/cells and every column's alignment.
Authored nodes have a `range: { start, end }` in original UTF-16 source units.
Padded table cells have `range: null`. Code values exclude the final renderer newline.
The snapshot includes `revision`,
`profile` and explicit enabled `capabilities`; `setText` and `edit` advance the
revision. Snapshots remain valid after edits, WASM memory growth and disposal.
Semantic extraction materializes the complete document; viewport decoration
costs do not measure this operation.

`new MarkdownDocument({ gfm: true, cjk: true, math: true })` enables the chat
profile's CJK delimiter rules and double-dollar math. GFM enables footnotes.
Raw HTML remains parser data; consumers own sanitization and safe activation.
Disposal is idempotent, and subsequent document operations throw `TypeError`.

`doc.presentation({ input: 'open' })` returns an owned snapshot with the original
UTF-16 `source`, requested `input`, revision, profile, capabilities, root, and
`provisional`, `suppressed`, and `references` metadata arrays. Use `input: 'ended'`
when more source is no longer expected. Queries do not change the source revision
or seal the document; further edits and open queries remain valid.

Open presentation interprets eligible unfinished emphasis, strike, code, links,
images, and math in native code. Nested openers retain their native ownership;
code and TeX keep received content opaque. `provisional` records each affected
node's path and reason. Ambiguous trailing inline markers without content appear
in `suppressed`; an empty resulting paragraph is omitted. Only the final open
source-mapped leaf receives this interpretation, including quote/list continuations.
Ended presentation and `semantics()` keep the exact interpretation.

Open presentation also suppresses empty trailing heading, quote, list, and task
markers. Visible siblings remain in the tree, and `suppressed` records each
withheld source range. Ended reads retain the exact block interpretation.

`references` reports normalized native reference dependencies in source order,
including unresolved uses and references inside nested containers and footnotes.
The `link` kind covers reference links and reference images; `footnote` covers
footnote references. Each record includes the authored use range and its current
resolution. Reference labels follow the CommonMark limit of 999 characters.
Definitions can change earlier uses on the next read. Code, math,
and HTML payloads remain opaque to reference interpretation.

CHAT math uses double dollars for inline expressions, such as `p $$x$$ q`.
Single dollars remain literal, including currency. This follows Streamdown's
[currency rationale and pinned configuration](chat-math.md#dollar-policy).

A line-start dollar run of at least two dollars opens flow math if the rest of the
line contains no dollar. Its opening-line suffix is nullable `meta`; subsequent
lines form `value`. For example, `$$tex\nx\n$$` has meta `tex` and value `x`.
Inline math remains value-only. A missing quote or list prefix ends flow math;
the following line is parsed under its actual container. An unclosed flow is
`pendingMath` only at eligible source EOF during open presentation and exact
`math` after input ends. See the [CHAT math contract](chat-math.md).

The authored streaming checkpoint matrix passes through `bun run streaming:check`.
`bun run streaming:qualification` runs the exhaustive chunk and lifecycle matrix.

Received source preserves NUL, BOM, CRLF, and lone surrogate units separately from
Markdown normalization. Presentation trees are recursively distinct from exact
trees and define pending link, image, and math variants for native interpretation.
Pending links and images have no destination field. Ended snapshots expose exact
roots and empty provisional/suppressed arrays. Returned strings, arrays, and trees
remain owned after edits, shared-memory growth, and disposal.

Kinds are in `Kind` (`js/index.js`). Records come in tree order; inline records of a block follow
the block. `LinkText` gives the text range of a link or image, so live preview can keep it and
hide the brackets and destination.

`init` loads `../tree-sitter-markdown.wasm` for the base grammar,
`../tree-sitter-markdown-chat.wasm` for CHAT, and `../tree-sitter-md.wasm` for the
resolver relative to `js/index.js`, into the host's `web-tree-sitter` runtime.
Math-enabled documents select CHAT before parsing; math-disabled documents keep the
base grammar. Custom asset loading accepts `grammar`, `chatGrammar`, and `resolver`.
Both grammar options accept a loaded `Language` or the same URL, byte, and response
inputs. The package
requires tree-sitter-x's 0.28 runtime line, starting at 0.28.1, through its `^0.28.1`
peer range. The host pins one built Git package and resolves both packages to it with a root
`overrides` entry for `web-tree-sitter`. Its
`heap`, `loadExtension`, `Parser.init` and `Language` APIs let the resolver share the host's
WebAssembly memory and tree-sitter C API. Install that runtime alongside `tree-sitter-md`.
The development and packed-consumer tests retain an exact known-good tree-sitter-x pin.
Compatible host runtime updates can advance independently of the Markdown package.
Bundlers that pre-bundle dependencies (Vite's `optimizeDeps`) should exclude the package, or pass
the wasm URLs to `init`.

`frontmatter` defaults to `false` for CommonMark parsing. Enable it for files with an opening
`---` or `+++` metadata block. Closing delimiters must match the opening delimiter; the body
keeps its original UTF-16 offsets. Definitions inside metadata do not resolve body links.

Container parsing is bounded to 200 open containers. Additional quote or list markers remain
source text at that depth. This keeps scanner serialization within tree-sitter's fixed buffer
and avoids a trap that could damage other documents sharing the runtime.
