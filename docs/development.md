# Development

Markdown for editors on [tree-sitter-x](https://github.com/ShaulLavo/tree-sitter-x): a
tree-sitter block grammar (a fork of
[tree-sitter-markdown](https://github.com/tree-sitter-grammars/tree-sitter-markdown) with one
token per line) and a C inline resolver (cmark 0.31.2's delimiter and bracket stacks,
document-wide reference definitions, GFM autolink literals). The resolver is a tree-sitter-x
extension: it runs inside the same runtime and memory as every other language and walks trees in
C. JavaScript gets compact records for the rows it asks about: decoration ranges and kinds,
highlight captures, fold ranges and fence injections.

Release 0.1 passes all 676 CommonMark/GFM examples, 183 chat fixtures and the pinned
497-document repository corpus. Current correctness gates and Chromium measurements are in
[docs/RELEASE-0.1.md](RELEASE-0.1.md).

## Layout

| Path | What |
| --- | --- |
| `grammar/` | The base block grammar and scanner, plus the derived CHAT profile in `chat/` |
| `src/document.c` | UTF-16 document, incremental tree, definitions, per-leaf cache, record walks and wasm exports |
| `src/leaf.c` | Leaf content and continuation mapping; cmark inline pass with no block parse |
| `src/autolink.c` | GFM autolink literals ported from cmark-gfm |
| `src/highlight.c` | Highlight captures derived from decoration records |
| `vendor/` | cmark 0.31.2 inline dependencies; tree-sitter-x's `api.h` |
| `js/` | The JS binding and types |
| `bench/` | Spec runner, corpus runner, keystroke benchmark, fuzz test, Chromium cold load, memory |

## Build

The resolver builds with WASI SDK 34 as a side module (`-fPIC -shared`, no libc): tree-sitter
and libc come from the tree-sitter-x runtime it is loaded into. Set `WASI_SDK` to the extracted
SDK directory before building. The grammar builds with the same WASI SDK.
The tree-sitter CLI is needed only to regenerate parse tables. `npm run generate`
regenerates both profiles with CLI 0.26.9; generated files are never edited by hand.
The [CHAT source inventory](chat-math.md#source-inventory) classifies the local changes.
`web-tree-sitter` is tree-sitter-x's built package (`github:ShaulLavo/tree-sitter-x#<commit>`,
its `web-tree-sitter` branch). The native tests compile tree-sitter-x's C runtime from a checkout:
`TREE_SITTER_LIB` is its `lib/`, `../tree-sitter-x/lib` by default.

```sh
npm run generate   # only when changing the grammar; tree-sitter CLI 0.26.9
npm run build      # resolver, base grammar, and CHAT grammar wasm
OPT=-Oz npm run build
npm test           # focused wasm API regressions
bun run test:types # public exact/presentation type contracts
sh scripts/check-native.sh  # native clang, ASan + UBSan, incremental edits, leaf mapping and cursor oracle
sh scripts/check-cursor.sh  # cursor byte/point seeks against sequential traversal, ASan + UBSan
node bench/cursor-seek.mjs --check  # blank-line viewport cost across a heading-less 1 MB document
```

The semantic suite compares complete rendered output with every official
CommonMark/GFM example and tests decoded payloads, incremental results, source
mapping and lifetime. Sixteen GFM spec/profile differences have individual
source and output hashes in `tests/semantic-gfm-differences.json`; changed
receipts fail the suite. Install `bench` dependencies before running `npm test`.

The resolver imports only tree-sitter's C API and libc functions the tree-sitter-x runtime
exports; `tests/resolver.mjs` checks this.

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

For the full correctness gate, run `bun run check` from the repository root after
installing the bench dependencies. This requires 676/676 spec cases, the bundled
183-message chat corpus, exact differences for the bundled 497-document repository
corpus, both edit counts and the negative control.

`bun run test:package` packs the publishable files, installs that tarball in an isolated
consumer and checks Node, Bun and a Vite production build in Chromium. Install the browser
with `bunx playwright install chromium` first. Each runtime tests host-first, Markdown-first
and concurrent initialization, repeated initialization, sibling document isolation and
continued host parsing. The browser must fetch all four wasm assets, including the host runtime.

`bun run test:browser` checks public semantics with resizable Wasm memory, including
Unicode, heap growth, edits and retained results after disposal. Pass `chromium firefox webkit`
to run all three installed Playwright browsers. Set `TREE_SITTER_RUNTIME` to a built runtime
package directory to check that artifact.

The release workflow runs these checks plus all three wasm builds and native sanitizers.
The native source revision is pinned separately from the built JavaScript host package. Paired timing checks use `scripts/compare-builds.sh` and
`scripts/summarize.mjs` as described in FINDINGS.

The normalizer (`bench/constructs.mjs`) and method are Plan 176's in the Platform repository, so
numbers compare with its lezer and tree-sitter measurements. `corpus.mjs` reads the bundled [183-message chat corpus](../bench/corpus/README.md)
by default. Set `CHAT=/path/to/chat.json` to supply another corpus.

## Licensing

MIT, see [LICENSE](../LICENSE). Third-party code includes BSD-2-Clause, MIT and CC0 components. See
[NOTICE.md](../NOTICE.md) and `licenses/`.
