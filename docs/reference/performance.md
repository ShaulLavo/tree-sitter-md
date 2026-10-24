# Performance

Measured numbers with the commands that produce them. Nothing here is a claim about other hardware.

## Conditions

| | |
| --- | --- |
| Date | 2026-10-24 |
| Commit | `6889cfd` (package 0.1.32) |
| Machine | Apple M1, 8 logical CPUs, 16 GiB, macOS 26.4 |
| Runtime | Node 26.12.1. Chromium 153.0.8010.12 (Playwright 1.63.0). Bun 1.4.4 only starts the Chromium script. |
| Load | The machine was shared. The load average was about 13 on 8 CPUs during every run, so treat differences under about 20% as noise. Ranges are given where they matter. |
| Build | The committed `.wasm` files, built with `-O3` and WASI SDK 34. |

Setup, from the repository root:

```sh
bun install --frozen-lockfile
cd bench && bun install --frozen-lockfile
```

## Typing in a document

`bench/keystroke.mjs` parses the document, then makes 200 seeded one-character inserts after `" the "`. After each insert it decorates the 60 rows around the edit. The total covers the incremental block reparse, definition and cache invalidation, and the viewport decoration. lezer (`@lezer/markdown` with GFM) runs in the same process on the same text and edits.

```sh
cd bench && sh run-all.sh   # three runs per file, writes out/keystroke-runs.jsonl
```

Medians of the three runs, in milliseconds. The range of the three is in brackets where it is wider than 10%.

| | 46 KB, tree-sitter-md | 46 KB, lezer | 1 MB, tree-sitter-md | 1 MB, lezer |
| --- | ---: | ---: | ---: | ---: |
| Keystroke median | 0.17 | 0.16 | 0.66 [0.59 to 0.86] | 0.95 [0.72 to 1.29] |
| Keystroke p95 | 0.31 [0.29 to 0.40] | 0.36 [0.30 to 0.47] | 1.5 [1.4 to 1.8] | 6.2 [4.0 to 6.3] |
| First keystroke, after one idle `reparse()` | 0.68 [0.66 to 0.80] | 1.2 [1.1 to 3.0] | 1.7 [1.6 to 2.8] | 3.2 [2.6 to 4.9] |
| First keystroke, no idle `reparse()` | 0.66 | 0.95 | 3.0 [2.6 to 3.4] | 2.9 [2.7 to 4.0] |
| First frame: parse and decorate the first 60 rows | 0.83 | 0.81 | 0.73 [0.63 to 1.6] | 0.94 [0.74 to 1.25] |
| Full parse (block structure only) | 3.8 [3.3 to 4.2] | 6.1 [5.5 to 9.0] | 56 [45 to 76] | 83 [82 to 154] |
| Decorate every inline in the document | 1.9 | n/a | 34 [22 to 40] | n/a |
| Idle `reparse()` after opening | 0.1 | n/a | 15 | n/a |

The 46 KB file is `bench/docs/agents.md` (46,041 characters). The 1 MB file is `bench/docs/big.md` (1,000,143 characters). The script checks that the edited document equals a fresh parse (`editedEqualsFresh`).

At 46 KB the two parsers tie on typing. At 1 MB tree-sitter-md has the lower median and a much lower p95. The first keystroke without an idle `reparse()` costs about as much as lezer's at 1 MB, and about 1.3 ms less with one.

## Reading a complete document

`semantics()` and `presentation()` read the whole document. `bench/presentation.mjs` times, per case, a fresh `setText`, then `semantics()`, then `presentation({ input: 'open' })`, then `presentation({ input: 'ended' })`. Each includes the native extraction, the copy to JavaScript, and strict decoding. All cases use `gfm`, `cjk` and `math`.

```sh
node bench/presentation.mjs --list
node bench/presentation.mjs --samples 15 --warmup 2 > report.json
```

Median milliseconds over 15 samples, one fresh process per case:

| Case | UTF-16 units | `setText` | `semantics()` | `open` | `ended` |
| --- | ---: | ---: | ---: | ---: | ---: |
| Median chat message | 73 | 0.07 | 0.08 | 0.05 | 0.03 |
| 90th-percentile chat message | 431 | 0.10 | 0.12 | 0.09 | 0.07 |
| Longest chat message | 8,642 | 0.46 | 0.90 | 0.99 | 1.02 |
| Structured response, 32 KiB | 32,768 | 4.0 | 5.3 | 5.9 | 6.0 |
| Structured document, 256 KiB | 262,144 | 31 | 40 | 46 | 51 |
| One 256 KiB paragraph with dense inline markup | 262,144 | 12 | 46 | 57 | 59 |
| 2,048 late reference definitions | 63,531 | 31 [p95 111] | 15 [p95 55] | 18 [p95 85] | 19 [p95 91] |
| 64 nested quote levels | 1,441 | 0.23 | 0.52 | 0.11 | 0.49 |

The chat messages come from `bench/corpus/chat.json` (183 messages). A full read is linear in document size. One giant paragraph is one leaf for the inline resolver. An edit inside it invalidates the cache entry for that leaf, so the next read resolves the whole paragraph again.

## Load time in Chromium

`bench/chromium.mjs` uses a fresh browser context per run with `no-store` caching, and reports the median of five. `load` is `init()`: fetch, compile and instantiate the host runtime, both grammars and the resolver. `first frame` is `setText` on the first 60 rows plus `decorations` and `highlights` for them, on a cold page: V8 compiles WebAssembly functions lazily. `full` is the first `setText` of the whole file on a second document. `repeated` is a second `setText` of the same file.

```sh
cd bench && PLAYWRIGHT=$PWD/../node_modules/playwright/index.js bun chromium.mjs
```

`PLAYWRIGHT` is the path of Playwright's `index.js`. Set it before running the script.

| Milliseconds | `load` | `first frame` | `full` | `repeated` |
| --- | ---: | ---: | ---: | ---: |
| tree-sitter-md, 46 KB | 9.7 | 7.1 | 4.2 | 3.8 |
| lezer, 46 KB | 3.7 | 5.4 | 8.0 | 5.8 |
| tree-sitter-md, 1 MB | 9.2 | 7.3 | 52.5 | 52.8 |
| lezer, 1 MB | 4.0 | 5.2 | 89.1 | 78.8 |

tree-sitter-md loads more code and its cold first frame is slower than lezer's. Both gaps are a few milliseconds.

## Size

Bytes of the committed files. Gzip is `gzip -9n`.

| File | Raw | Gzip |
| --- | ---: | ---: |
| `tree-sitter-md.wasm` (resolver) | 240,370 | 97,724 |
| `tree-sitter-markdown.wasm` (base grammar) | 137,461 | 27,862 |
| `tree-sitter-markdown-math.wasm` (math grammar) | 143,613 | 28,833 |
| `js/index.js`, `js/constants.js`, `js/semantic.js` | 18,299 | 5,574 |
| Host runtime, `web-tree-sitter.wasm` and `web-tree-sitter.js` from tree-sitter-x | 340,415 | 113,758 |

`init()` loads both grammars, so a page fetches all three `.wasm` files: 520,954 bytes raw and 154,284 gzip, plus the wrapper. An app that already ships the host runtime adds only those. Both grammars load even if no document uses `math: true`.

```sh
wc -c tree-sitter-md.wasm tree-sitter-markdown.wasm tree-sitter-markdown-math.wasm
gzip -9n -c tree-sitter-md.wasm | wc -c
```

## Memory

`bench/memory.mjs` measures the growth of WebAssembly linear memory in a fresh process. It is a high-water mark. Memory never shrinks, and disposed documents make their allocations reusable.

```sh
cd bench && node memory.mjs
```

| Document | After parse and viewport decoration | After decorating every inline |
| --- | ---: | ---: |
| 46 KB | 0.56 MiB | 0.69 MiB |
| 1 MB | 9.13 MiB | 9.81 MiB |

The UTF-16 copy of the text is part of this. JavaScript strings and embedded-language trees are not.

## Not measured

- Rendering time. The benchmarks stop at the data handed to JavaScript.
- Firefox and WebKit.
- Peak resident memory.
- Machines other than the one above.
