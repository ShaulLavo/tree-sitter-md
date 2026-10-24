# Development

Set up, build, test and measure tree-sitter-md. For how the parts fit together, read [How tree-sitter-md works](concepts/architecture.md) first.

## Layout

| Path | Contents |
| --- | --- |
| `grammar/` | The base block grammar (`grammar.js`, `src/scanner.c`) and the CHAT profile in `grammar/chat/`. `src/` and `chat/src/` are generated. |
| `src/document.c` | The UTF-16 document, the incremental tree, definitions, the per-leaf cache, record walks and the wasm exports. |
| `src/leaf.c` | Leaf content and continuation mapping. Runs cmark's inline pass with no block parse. |
| `src/semantic.c`, `src/footnote.c` | `semantics()` and `presentation()` extraction, footnotes. |
| `src/autolink.c`, `src/highlight.c` | GFM autolink literals ported from cmark-gfm. Highlight captures derived from decoration records. |
| `vendor/` | cmark 0.31.2's inline pass and tree-sitter's `api.h`. See `vendor/README.md`. |
| `js/` | The JavaScript binding and its types. |
| `tests/` | JavaScript, native C and fixture tests. `tests/streaming/README.md` describes the streaming fixtures. |
| `bench/` | Spec runner, corpus runner, keystroke, memory and Chromium benchmarks, fuzz test, benchmark inputs. |
| `scripts/` | Build, check and gate scripts. |
| `experiments/perf-next/` | Benchmark and stress probes that take a checkout path. Not part of the package or CI. |

Generated files (`grammar/src/parser.c`, `grammar/chat/src/`) are never edited by hand. Change `grammar.js` and run `npm run generate`.

## Install

You need Node 26 or later and Bun 1.4.4 (the version CI pins).

```sh
bun install --frozen-lockfile
cd bench && bun install --frozen-lockfile
```

The tests import the package from the working tree, and the benchmarks import it through `bench`'s `file:..` dependency. Install the `bench` dependencies before `npm test`, because `tests/semantics.mjs` reads `bench/node_modules/commonmark-spec`.

## Build

The committed `.wasm` files are build outputs. Rebuild them after you change `src/`, `vendor/` or `grammar/`.

```sh
export WASI_SDK=/path/to/wasi-sdk-34.0-x86_64-linux  # WASI SDK 34
npm run build                                          # resolver and both grammars
OPT=-Oz npm run build                                  # size build; the default is -O3
npm run generate                                       # only after editing grammar.js; tree-sitter CLI 0.26.9
```

`scripts/build.sh` compiles the resolver as a side module (`-fPIC -shared -nostdlib`) that imports tree-sitter's C API and libc from the host. It compiles each grammar with `vendor/cmark/*.c`, because the scanner calls cmark.

This page was written without a WASI SDK, so the build commands are documented from `scripts/build.sh` and CI, and were not run here.

## Test

| Command | Checks | Needs |
| --- | --- | --- |
| `npm test` | Every `tests/*.mjs` and `tests/*.test.ts` with `node --test`. 2,906 tests passed in about 20 seconds on Node 26.12.1. | Node 26, `bench` dependencies |
| `bun run test:types` | The public `semantics()` and `presentation()` types in `tests/types/presentation.ts`. | TypeScript 7. If a `tsconfig.json` exists in a parent directory, `tsc` stops with TS5112. Run the command from `package.json` with `--ignoreConfig` added. |
| `bun run check` | The gate: 676 of 676 spec examples, the 183 chat messages, the 497-document repository corpus against its committed difference manifest, 11,000 and 300 fuzz edits, and the negative controls. About 70 seconds. | `bench` dependencies |
| `bun run test:browser` | `semantics()` with resizable memory in Chromium. Pass `chromium firefox webkit` to run more browsers. | `bunx playwright install chromium` |
| `bun run test:package` | Packs the package, installs the tarball in a clean consumer, and runs Node, Bun and a Vite production build in Chromium, each in host-first, markdown-first and concurrent initialization order. | Playwright Chromium |
| `TREE_SITTER_LIB=/path/to/tree-sitter-x/lib sh scripts/check-native.sh` | Native clang builds with ASan and UBSan: 2,000 incremental edits, leaf mapping, presentation, footnotes and nested lists. | Linux and a tree-sitter-x checkout. CI uses commit `5c7a2916cdfa93f107833ddaa67688ec16d88a7d`. On macOS the script aborts because ASan has no leak detection there. |
| `TREE_SITTER_LIB=... sh scripts/check-cursor.sh` | Cursor seeks against sequential traversal. | The same as above. |
| `node bench/cursor-seek.mjs --check` | Blank-line viewport cost in a 1 MB document with no headings. | `bench` dependencies |

`bun run test:package` and `bun run test:browser` passed when this page was written. CI runs everything above except `check-cursor.sh` and `cursor-seek.mjs`, in `.github/workflows/check.yml`.

### Streaming qualification

```sh
mkdir -p target/reports
node --test tests/streaming-qualification.mjs tests/presentation-lifetime.mjs
node scripts/check-streaming-qualification.mjs > target/reports/streaming-qualification.json
node --test tests/streaming-driver.mjs tests/streaming.mjs   # authored fixtures
```

The report exits 0 for `READY`, 1 for comparison failures and 2 for missing presentation checks. It records artifact hashes, corpus provenance, schedule seeds and failure witnesses. CI keeps the JSON as the `streaming-qualification` artifact. `bun run streaming:qualification` runs the same script.

The matrix feeds every UTF-16 prefix and two-chunk boundary of 33 authored fixtures, plus fixed-seed schedules over the pinned chat and repository corpora, through fresh and edited exact, open and ended reads.

### Add a regression test

Put the source text and expected output in a fixture under `tests/fixtures/` when it came from a saved observation, and keep the original UTF-16 source hash. Write `tests/<topic>.test.ts` beside the others. Compare against output from a reference implementation (cmark, cmark-gfm, micromark), never against this parser's own result. Test both grammar profiles for scanner changes, and edit-then-undo against a fresh parse for anything incremental.

## Benchmark

```sh
cd bench
node spec.mjs [--fail]            # spec examples against micromark, beside lezer
node corpus.mjs                   # repository docs and chat messages
sh run-all.sh                     # keystroke runs for both files, then memory
node fuzz.mjs docs/agents.md 11000 1   # incremental equals fresh after random edits
node memory.mjs                   # linear memory per document
PLAYWRIGHT=$PWD/../node_modules/playwright/index.js bun chromium.mjs   # cold load in Chromium
cd .. && node bench/presentation.mjs --samples 15 --warmup 2           # complete-document reads
```

`bench/chromium.mjs` defaults `PLAYWRIGHT` to a path on the owner's machine, so set it. Results and method are in [Performance](reference/performance.md). `bench/corpus.mjs` reads the [chat corpus](../bench/corpus/README.md) by default. Set `CHAT=/path/to/chat.json` to use another.

`scripts/compare-builds.sh` and `scripts/summarize.mjs` run paired timings of two builds. `scripts/snapshot-repositories.mjs` regenerates the repository corpus snapshot from checkouts of the two source repositories.

## Versions

Each fix merged so far bumps the patch version in `package.json`, and the changelog has one entry per version. npm has only 0.1.0 and 0.1.1 (2026-09-28). See [Compatibility](reference/compatibility.md#stability).

## Licensing

MIT, see [LICENSE](../LICENSE). Third-party code includes BSD-2-Clause, MIT and CC0 components. See [NOTICE.md](../NOTICE.md), `licenses/` and [Source provenance](reference/provenance.md).
