# tree-sitter-md

Markdown for editors in one wasm module: a tree-sitter block grammar (a fork of
[tree-sitter-markdown](https://github.com/tree-sitter-grammars/tree-sitter-markdown) with one
token per line) and a Rust inline resolver (CommonMark's delimiter and bracket stacks,
document-wide reference definitions, GFM autolink literals). JavaScript gets compact records for
the rows it asks about: decoration ranges and kinds, highlight captures, fold ranges and fence
injections. The tree never crosses into JS.

Status: a measured spike (2026-09-26), not a release. Results are in
[docs/FINDINGS.md](docs/FINDINGS.md): 672/676 CommonMark + GFM examples, 0.49 ms median keystroke
at 1 MB, 193 KB gzip.

## Use

```js
import { init, MarkdownDocument, Kind, CAPTURES } from 'tree-sitter-md'

await init() // or init(fetch(url)), init(bytes), init(compiledModule)
const doc = new MarkdownDocument({ gfm: true })
doc.setText(text)
doc.reparse() // once, in idle time after setText: keeps the first keystroke cheap
doc.edit(start, oldEnd, 'inserted') // UTF-16 offsets, like JS strings
const records = doc.decorationsForRows(fromRow, toRow) // Uint32Array of [start, end, kind, extra]
const captures = doc.highlights(from, to) // [start, end, capture], names in CAPTURES
const folds = doc.folds(from, to) // [start, end]
const fences = doc.injections(from, to) // [contentStart, contentEnd, langStart, langEnd]
doc.dispose()
```

Kinds are in `Kind` (`js/index.js`). Records come in tree order; inline records of a block follow
the block. `LinkText` gives the text range of a link or image, so live preview can keep it and
hide the brackets and destination.

The module loads `../tree-sitter-md.wasm` relative to `js/index.js`. Bundlers that pre-bundle
dependencies (Vite's `optimizeDeps`) should exclude the package, or pass the wasm URL to `init`.

## Layout

| Path | What |
| --- | --- |
| `grammar/` | The block grammar (`grammar.js`), generated `src/parser.c`, the external scanner |
| `src/doc.rs` | A document: UTF-16 text, the incremental tree, definitions, the per-block inline cache, the record walks |
| `src/inline.rs` | One leaf block (paragraph, heading, table cell) through pulldown-cmark's inline pass |
| `src/defs.rs` | Document-wide link reference definitions and which blocks depend on which labels |
| `src/autolink.rs` | GFM autolink literals, ported from markdown-rs |
| `src/highlight.rs` | Highlight captures (the Editor's markdown capture names) from records |
| `src/wasm.rs`, `js/` | The C-ABI exports and the JS binding |
| `bench/` | Spec runner, corpus runner, keystroke benchmark, fuzz test, Chromium cold load, memory |

## Build

Needs Rust (pinned in `rust-toolchain.toml`, target `wasm32-unknown-unknown`), clang with the
wasm32 target and `llvm-ar` (set in `.cargo/config.toml`), and the tree-sitter CLI only to
regenerate the grammar.

```sh
npm run generate   # grammar/grammar.js -> grammar/src/parser.c (tree-sitter CLI 0.26)
npm run build      # wasm into ./tree-sitter-md.wasm, plus the native `tsmd` driver
```

`scripts/build.sh` defaults `RUSTUP_HOME` and `CARGO_HOME` to `/work/cache`; set them to use
another toolchain home. `target/release/tsmd file.md` prints the records (`TREE=1` adds the
tree, `MEM=1` the Rust heap).

## Benchmarks and the spec suite

```sh
cd bench && bun install
node spec.mjs [--fail]                 # CommonMark 0.31.2 + GFM examples against micromark, beside lezer
CHAT=chat.json node corpus.mjs         # repository docs (Platform, Editor at pinned commits) and chat messages
node keystroke.mjs docs/big.md         # first frame, full parse, 200 keystrokes, lezer on the same edits
node fuzz.mjs docs/agents.md 3000 1    # incremental result equals a fresh parse after random edits
node memory.mjs                        # wasm memory per document
bun chromium.mjs                       # cold load and first frame in Chromium, beside lezer
sh run-all.sh                          # the three-run keystroke set used in FINDINGS.md
```

The normalizer (`bench/constructs.mjs`) and method are Plan 176's in the Platform repository, so
numbers compare with its lezer and tree-sitter measurements. `corpus.mjs` reads the chat corpus
from a path you supply; it is not part of this repository.

## Licensing

No license chosen yet. Ported and compiled-in work is MIT; see [NOTICE.md](NOTICE.md) and
`licenses/`.
