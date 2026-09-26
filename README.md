# tree-sitter-md

Markdown for editors in one wasm module: a tree-sitter block grammar (a fork of
[tree-sitter-markdown](https://github.com/tree-sitter-grammars/tree-sitter-markdown) with one
token per line) and a C inline resolver (cmark 0.31.2's delimiter and bracket stacks,
document-wide reference definitions, GFM autolink literals). JavaScript gets compact records for
the rows it asks about: decoration ranges and kinds, highlight captures, fold ranges and fence
injections. The tree never crosses into JS.

Status: a measured spike (2026-09-26), not a release. Results are in
[docs/FINDINGS.md](docs/FINDINGS.md): 672/676 CommonMark + GFM examples, 0.401 ms median
keystroke at 1 MB, and a measured C migration against the Rust baseline. The JS API is unchanged.

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
| `src/document.c` | UTF-16 document, incremental tree, definitions, per-leaf cache, record walks and wasm exports |
| `src/leaf.c` | Leaf content and continuation mapping; cmark inline pass with no block parse |
| `src/autolink.c` | GFM autolink literals ported from cmark-gfm |
| `src/highlight.c` | Highlight captures derived from decoration records |
| `vendor/` | cmark 0.31.2 inline dependencies and tree-sitter 0.27.0 C runtime |
| `js/` | The unchanged JS binding and types |
| `bench/` | Spec runner, corpus runner, keystroke benchmark, fuzz test, Chromium cold load, memory |

## Build

Uses one C toolchain for the grammar, scanner, tree-sitter runtime and resolver: WASI SDK 34
with clang 23, wasi-libc and dlmalloc. The SDK defaults to
`/work/cache/wasi-sdk-34.0-x86_64-linux`; set `WASI_SDK` for another installation.
[SDK releases](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-34) provide other
host platforms. No Rust or Emscripten installation is needed.

```sh
npm run generate   # only when changing the grammar; tree-sitter CLI 0.26
npm run build      # -O3 + LTO, tree-sitter-md.wasm
OPT=-Oz npm run build
npm test           # focused wasm API regressions
sh scripts/check-native.sh  # native clang, ASan + UBSan, incremental edits and cursor oracle
sh scripts/check-cursor.sh  # cursor byte/point seeks against sequential traversal, ASan + UBSan
node bench/cursor-seek.mjs --check  # blank-line viewport cost across a heading-less 1 MB document
```

The wasm module has no imports. Its allocator grows and reuses linear memory; the host supplies
no filesystem, process or clock services. The normal output remains the standalone wasm module.
The [side-module experiment](experiments/side-module/README.md) documents sharing the Editor's
web-tree-sitter runtime and the required host changes.

## Benchmarks and the spec suite

```sh
cd bench && bun install
node spec.mjs [--fail]                 # CommonMark 0.31.2 + GFM examples against micromark, beside lezer
node corpus.mjs                       # repository docs (Platform, Editor at pinned commits) and chat messages
node keystroke.mjs docs/big.md         # first frame, full parse, 200 keystrokes, lezer on the same edits
node fuzz.mjs docs/agents.md 11000 1    # incremental result equals a fresh parse after random edits
node memory.mjs                        # wasm memory per document
bun chromium.mjs                       # cold load and first frame in Chromium, beside lezer
sh run-all.sh                          # the three-run keystroke set used in FINDINGS.md
```

For the full correctness gate, run `CHAT=/path/to/chat.json node scripts/check-gates.mjs`
from the repository root. This checks the per-section spec floor, corpus, both edit counts and
the negative control. Paired timing checks use `scripts/compare-builds.sh` and
`scripts/summarize.mjs` as described in FINDINGS.

The normalizer (`bench/constructs.mjs`) and method are Plan 176's in the Platform repository, so
numbers compare with its lezer and tree-sitter measurements. `corpus.mjs` reads the bundled [183-message chat corpus](bench/corpus/README.md)
by default. Set `CHAT=/path/to/chat.json` to supply another corpus.

## Licensing

MIT, see [LICENSE](LICENSE). Third-party code includes BSD-2-Clause, MIT and CC0 components. See
[NOTICE.md](NOTICE.md) and `licenses/`.
