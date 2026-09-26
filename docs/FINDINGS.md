# Spike findings: custom tree-sitter grammar + Rust inline resolver (2026-09-26)

The original Rust measurements below are preserved as the baseline. See [C resolver](#c-resolver)
for the C replacement, paired gates and current build.

Question (Platform Plan 176, owner direction 2026-09-26): can one markdown parser, a custom
tree-sitter block grammar plus a Rust post-pass in one wasm module, clear the bar lezer set?

**Verdict: it clears every bar.** 672/676 spec examples (99.4%, lezer 97.9%), no real mismatch
against remark on the corpus (lezer about 20), 0.49 ms median and 1.0 ms p95 per keystroke at
1 MB (lezer 0.59 and 3.0 ms in the same runs), a 0.36 ms first frame. The costs: 193 KB gzip
against lezer's 20 KB, 7.5 MB of wasm memory for a 1 MB document, and a cold first frame on
Chromium's main thread that matches lezer's without beating it.

## What was built

- **Grammar** (`grammar/`): tree-sitter-markdown v0.5.3's block grammar with one token per line.
  Upstream tokenizes every word so the grammar can recognise link reference definitions by GLR;
  that made each paragraph a chain of fragile repeat nodes. Here definitions are paragraph content,
  as CommonMark defines them, and the resolver strips them. The info string, table rows and cells
  are single tokens. HTML blocks 1–5 keep word tokens (their end condition sits inside a line).
  The scanner is upstream's with ASCII classes (no libc, for `wasm32-unknown-unknown`) and
  `textarea` added (CommonMark 0.31). 556 states against upstream's 925.
- **Resolver** (`src/`): each leaf block (paragraph, setext content, ATX content, table cell) goes
  through pulldown-cmark 0.13.4's inline pass: delimiter stack with the rule of three, bracket
  stack with link-in-link deactivation and precedence, code spans, autolinks, raw HTML, entities,
  hard breaks, GFM strikethrough. Continuation lines are re-indented by four virtual spaces before
  the leaf parse, so a line the grammar kept in the paragraph (`    ***`, a lazy `- b`, `===`)
  cannot start a block there; ATX content and table cells get a virtual first line for the same
  reason. Table cells split on unescaped `|` and keep cells past the header count, as micromark
  does. GFM autolink literals are ported from markdown-rs.
- **Definitions** are document-wide: each paragraph that starts with `[` contributes definitions
  (first wins), the resolver records which labels each cached leaf looked up, and an edit that
  changes a definition drops exactly the leaves that depended on its label. Typing `[ZZ]: /x` at
  the end of a 12,000-line document turns `[zz]` on line 1 into a link; breaking the label turns
  it back.
- **Incrementality.** Block: tree-sitter's incremental reparse of the evolving tree. Definitions:
  rescanned only in the changed ranges. Inline: cached per leaf by a hash of its text and
  continuation layout, resolved lazily for the rows asked for, so a keystroke resolves one
  paragraph. Nothing is whole-document per keystroke.
- **Outputs**, all from the same parse: decoration records `[start, end, kind, extra]` (27 kinds,
  including heading, list, quote and fence marks and `LinkText`), highlight captures with the
  Editor's capture names (`text.title`, `text.strong`, `punctuation.delimiter`, …), fold ranges
  (sections, fences, quotes, list items, tables, HTML blocks), and fence injections
  `[contentStart, contentEnd, langStart, langEnd]`. Fence contents still need the language's own
  grammar, which stays with web-tree-sitter.
- **Package**: `tree-sitter-md` 0.1.0, ESM entry, types, the wasm inside (`npm pack`: 9 files,
  199 KB). A packed tarball installs with `bun add` and imports under Bun and Node.

## Correctness

CommonMark 0.31.2 (652) + GFM extension examples (24), normalized construct lists against
micromark, Plan 176's normalizer and method (`bench/spec.mjs`):

| Section | n | tree-sitter-md | lezer + refcheck | tree-sitter today (binding + refcheck) |
| --- | --: | --: | --: | --: |
| Emphasis and strong | 132 | 132 | 132 | 120 |
| Links | 90 | 90 | 84 | 82 |
| Images | 22 | 22 | 22 | 21 |
| Code spans | 22 | 22 | 22 | 18 |
| Raw HTML | 20 | 20 | 17 | 17 |
| Link reference definitions | 27 | 26 | 26 | 25 |
| Setext headings | 27 | 25 | 27 | 25 |
| List items | 48 | 47 | 46 | 47 |
| GFM autolinks | 11 | 11 | 11 | 0 |
| **Total** | 676 | **672 (99.4%)** | 662 (97.9%) | 631 (93.3%) |

The four failures: 96 and 98 open with `---`, which the grammar reads as frontmatter (always on,
and right for 84 repository docs); 216 is a setext underline under a paragraph made only of
definitions; 260 is a lazy continuation inside two nested quotes in a list (upstream's scanner).

Real content against micromark + GFM (`bench/corpus.mjs`; `tight` and math ignored). Repository
docs at Platform `c130dd35a` and Editor `74e76be`, as Plan 176 used them:

| | Chat, 183 messages | Repo, 497 docs identical | Repo missing / extra constructs (of 105,952) |
| --- | --: | --: | --- |
| tree-sitter-md | 183/183 | 406/497 | 208 / 33, all explained: 172 in the 84 frontmatter docs (micromark reads frontmatter as a rule and a heading), 33 + 33 task-item paragraph shape (lezer has the same 33), 3 autolink literals mdast gives no position (lezer the same). Real: 0 |
| lezer GFM + refcheck | 183/183 | 488/497 | 43 / 46, about 20 real (email false positives in `pkg@1.0.0`, code spans) |

Incremental equals fresh: `bench/fuzz.mjs` makes random edits (markdown characters, newlines,
deletions, definitions typed and removed, tables, fences) and compares every tenth result with a
fresh parse: 0 differences in 11,000 edits on `AGENTS.md` and 300 on the 1 MB file. A control
that compares against slightly different text fails every check.

## Speed

Node 26.7.0 (V8), i7-14700K shared with other agents, medians of three runs in a wave-heavy slot
(`bench/run-all.sh`). Same files as Plan 176 (`AGENTS.md` 46 KB, `docs/` + `plans/` cut at
1,000,143 chars), the same 200 seeded one-character inserts after `" the "`, each followed by
decorations for the 60 rows around the edit. lezer ran in the same process on the same edits.
"tree-sitter today" is the calibration's careful integration (block + touched inline + visible
inlines), measured earlier on the same machine.

| ms | tree-sitter-md 46 KB | lezer 46 KB | tree-sitter today 46 KB | tree-sitter-md 1 MB | lezer 1 MB | tree-sitter today 1 MB |
| --- | --: | --: | --: | --: | --: | --: |
| First frame, 60 rows (parse prefix + decorate) | 0.39 | 0.57 | 2.3 | 0.36 | 0.47 | 2.2 |
| Full parse (tree-sitter: block only) | 1.4 | 3.3 | 7.4 | 26 | 48 | 128 |
| Decorate the whole document (every inline) | 1.1 | — | — | 16.5 | — | — |
| Rest of the document as an append edit | 2.2 | — | — | 29 | — | 128 |
| Keystroke median | 0.079 | 0.097 | 0.30 | 0.49 | 0.59 | 2.4 |
| Keystroke p95 | 0.14 | 0.21 | 0.93 | 1.0 | 3.0 | 4.8 |
| Keystroke max | 0.31 | — | — | 1.4 | — | — |
| First keystroke, one idle reparse after open | 0.44 | 0.79 | 2.4 | 1.6 (idle reparse 7.9) | 2.3 | 4.8 (idle 41) |
| First keystroke, no idle reparse | 0.45 | 1.0 | 2.4 | 2.4 | 2.4 | 46 |

Split of the 1 MB keystroke: 0.19 ms edit (block reparse, definitions, cache invalidation) and
0.27 ms decorating 60 rows (the edited paragraph resolved again, the rest from cache). With the
cache warm, 60 rows cost 0.023 ms for decorations, 0.024 ms for highlights, 0.008 ms for folds and
0.007 ms for injections; folds and injections for the whole 1 MB document cost 0.67 and 0.59 ms.

The one-token-per-line grammar keeps tree-sitter's first-leaf rule (calibration §2) but pays it on
far fewer nodes: the first reparse after a full parse costs 8.6 ms at 1 MB (43 ms with upstream's
grammar), an unchanged reparse after that 1.06 ms (3.5 ms).

## First frame, load and size

Chromium (Playwright 1.63), fresh context per run, `no-store`, median of 5 (`bench/chromium.mjs`):

| ms | Load (fetch + compile + instantiate) | First frame, 60 rows, cold | Full parse, 1 MB, warm |
| --- | --: | --: | --: |
| tree-sitter-md | 2.4 | 6.4 (`AGENTS.md`) / 9.5 (1 MB) | 31 |
| lezer + GFM (Plan 176's bundle) | 4.2 | 7.7 / 6.4 | 45 |

The cold first frame is the first call into each wasm function (V8 compiles wasm lazily); warm it
is 0.4 ms. Decorating the first frame therefore means running this module on the main thread,
loaded ahead of time (Plan 170's warm-up) with one throwaway parse to compile the hot functions;
the worker can hold its own instance for everything else. Cold, both cost about the same as lezer.

| Payload | Raw | Gzip |
| --- | --: | --: |
| tree-sitter-md.wasm (`opt-level=3`) | 562 KB | 193 KB |
| same, `opt-level=z` (10–20% slower keystrokes) | 458 KB | 161 KB |
| lezer + GFM | 60 KB | 20 KB |
| today's tree-sitter markdown (web-tree-sitter JS + runtime + 2 grammars) | 725 KB | 221 KB |

Code by origin (`opt-level=3`): pulldown-cmark about 120 KB with its share of core, the tree-sitter
C runtime 96 KB, our Rust 49 KB, the scanner and lexer 28 KB; data 178 KB (parse tables,
pulldown-cmark's entity table, case folding). The module carries its own tree-sitter runtime: in
the Editor worker, which keeps web-tree-sitter for fence languages, the runtime ships twice.

Memory (`bench/memory.mjs`, growth of a fresh instance's linear memory, a high-water mark): 0.5 MB
for `AGENTS.md`, 7.5 MB for the 1 MB document after parsing (2 MB of it the UTF-16 text), 8.4 MB
with every inline resolved. lezer measured about 600 KB and 4.6 MB for 1.36 MB (Plan 176, JS heap).

## What production needs

1. **Own the inline pass** (M). Vendor pulldown-cmark's inline code with an entry point that takes
   one leaf's content, instead of running its block pass per leaf behind the virtual-indent trick.
   Removes the trick and its edge cases (an HTML tag whose `>` opens a continuation line), and
   most of the 120 KB. Keep the MIT notice.
2. **Editor integration** (L). A markdown root layer backed by this module in the worker (records
   in place of web-tree-sitter captures, fence injections handed to web-tree-sitter), a main-thread
   instance for the first frame, live preview reading records instead of recovering constructs from
   captures (Plan 176 Phase 2 with records for nodes).
3. **Remark parity for chat** (M, only if chat moves): footnotes and `$$` math (pulldown-cmark has
   options for both), CJK-friendly flanking, list tightness.
4. **The last four spec examples and a frontmatter switch** (S).
5. **Tests and release** (S): cargo tests, the spec floor and fuzz in CI, a wasm build job, a
   license, `npm publish`.
6. **Size and memory, if they matter** (M): `opt-level=z` plus wasm-opt; sharing one tree-sitter
   runtime with web-tree-sitter (the grammar as a web-tree-sitter language, the resolver as its own
   module) at the cost of the tree crossing a module boundary.

## C resolver

Measured 2026-09-26 on `c-resolver`, against a Rust build from `4214f0c`. This section supersedes
Rust-specific production recommendations above. No publishing, Editor integration, remaining
spec fixes, frontmatter option or Plan 189 extensions are included.

The resolver is now C throughout. `vendor/cmark/` contains cmark 0.31.2's inline pass and its
required dependencies. `inline_resolve` takes one leaf's UTF-8 content, its byte-to-document
continuation mapping, definitions and options, and returns decoration records and looked-up
labels. It runs no block pass and inserts no virtual indentation. GFM strikethrough and autolink
literals come from cmark-gfm's extensions; its 0.29 core is absent. Document-wide first-wins
references, changed-label invalidation, text/layout cache keys, lazy visible-leaf resolution,
records, highlights, folds and fence injections retain the existing JS and wasm API.

Two adapter fixes were necessary to reach the floor: definition destinations must accept leaf
EOF, and cmark's backtick cache must retain its furthest observed closer after an unsuccessful
long-run scan. The latter has a focused regression test. ASan found an absent-title null-pointer
copy that was invisible in wasm; nullable reference ownership and comparison are now explicit.
The final native ASan/UBSan run checks 2,000 incremental edits with leak detection enabled.

### Correctness gates

| Gate | Rust | C |
| --- | ---: | ---: |
| CommonMark 0.31.2 + GFM | 672/676 | 672/676 |
| Per-section floor | baseline | every section equal |
| Chat messages | 183/183 | 183/183 |
| Repository real mismatches | 0 | 0 |
| Repository docs identical to micromark | 406/497 | 406/497 |
| Incremental/fresh differences, 11,000 edits at 46 KB | 0 | 0 |
| Incremental/fresh differences, 300 edits at 1 MB | 0 | 0 |
| Negative control, 100 edits / 10 checks | fails 10/10 | fails 10/10 |

The same four spec examples fail: 96, 98, 216, 260. Repository inputs remain Platform
`c130dd35a` and Editor `74e76be`. A direct Rust/C comparison found **identical normalized
construct lists in every one of the 497 documents**. The 208 missing / 33 extra constructs
against micromark are the same three explained shape differences as the Rust spike.

The original private chat JSON had been deleted. A read-only backup at
`/work/backups/platform/20260926T133030Z/prod/fs-metadata.sqlite` recovered 183 assistant messages,
64,199 characters and 859 normalized constructs, matching the earlier corpus description.
Both builds ran on this same recovered input. Its exported JSON SHA-256 is
`11190fb287db40120997d200e9cd36beaf7bd2410cf0956271313b3eb3c76f53`.
No private message text is committed.

The current artifact includes subsequent [review fixes](#review-fixes-and-current-artifact),
with fresh measurements below. The initial measurements here remain as historical evidence.

### Paired speed

Node 26.7.0, i7-14700K, shared machine, `-O3`. `scripts/compare-builds.sh` runs the unchanged
`bench/run-all.sh` for both builds in each of three rounds, reversing build order in round two.
Each invocation has three repetitions, so each row below is the median of nine runs of the
same 200 seeded edits. Both builds and Chromium runs held one wave-heavy slot for the whole
comparison. Raw results, hashes and summaries are in [`measurements/c-resolver/`](measurements/c-resolver/).

| Milliseconds | Rust 46 KB | C 46 KB | Rust 1 MB | C 1 MB |
| --- | ---: | ---: | ---: | ---: |
| First frame, 60 rows | 0.382 | 0.306 | 0.355 | 0.308 |
| Full block parse | 1.416 | 1.364 | 25.749 | 24.954 |
| Decorate whole document | 1.100 | 0.700 | 15.800 | 10.400 |
| Keystroke median | 0.076 | 0.062 | 0.442 | 0.401 |
| Keystroke p95 | 0.139 | 0.119 | 0.936 | 0.845 |
| First keystroke after idle reparse | 0.434 | 0.344 | 1.482 | 1.148 |
| First keystroke without idle reparse | 0.436 | 0.356 | 2.336 | 2.001 |

The initial C implementation scanned cache dependencies on every edit. Rust only does so when
reference definitions change. Matching that behavior reduced C's initial 1 MB median from about
0.458 ms to below Rust's floor. No layout or parser redesign was needed.

### Size, memory and Chromium

Exact bytes, compressed with `gzip -9n`. Rust's size build uses `opt-level=z`; its C build script
continues to compile the grammar at `-O3`. The C size build applies `-Oz` to every component.
The shipped C artifact is the measured `-O3` build; `-Oz` is a size report, not a speed claim.

| Build | Raw bytes | Gzip -9 bytes |
| --- | ---: | ---: |
| Rust `opt-level=3` | 561,739 | 193,422 |
| C `-O3` + LTO | 377,481 | 129,730 |
| Rust `opt-level=z` | 465,319 | 163,783 |
| C `-Oz` + LTO | 292,714 | 107,471 |

`bench/memory.mjs` reports growth of linear memory, a high-water mark, in MiB:

| Document / stage | Rust | C |
| --- | ---: | ---: |
| 46 KB parsed / viewport decorated | 0.50 | 0.50 |
| 46 KB wholly decorated | 0.56 | 0.56 |
| 1 MB parsed / viewport decorated | 7.50 | 7.25 |
| 1 MB wholly decorated | 8.44 | 7.88 |

Chromium via Playwright 1.63. Each round is the unchanged harness's median of five fresh browser
contexts, `no-store`; these are the medians of the three paired rounds, milliseconds:

| Document / stage | Rust | C |
| --- | ---: | ---: |
| 46 KB load | 2.2 | 1.8 |
| 46 KB cold first frame | 6.5 | 7.7 |
| 1 MB load | 2.0 | 1.9 |
| 1 MB cold first frame | 9.4 | 8.0 |
| 1 MB warm full parse | 31.0 | 28.7 |

Cold first frame at 46 KB regressed by 1.2 ms in these runs. The browser measurements were a
reporting requirement; the keystroke median/p95 gates and the warm first-frame comparison pass.
There is no claim that all cold-load cases improved.

### Toolchain and allocator

WASI SDK 34.0, clang/LLVM 23.1.0 (`895aa2c896ad`), wasi-libc
`2e6fb9d8ee0cdf9e431fbcabe8af3115de000a13`. Installed at
`/work/cache/wasi-sdk-34.0-x86_64-linux` after checking the `/work` mount and free space.
The x86_64 Linux archive SHA-256 is
`b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4`.

One clang invocation compiles grammar, scanner, runtime and resolver, with LTO and a 1 MiB stack.
The libc is wasi-libc's musl-derived C library; its default allocator is dlmalloc 2.8.6, confirmed
in `libc.a`. It provides realloc/free and reuses released blocks, which both tree-sitter and
cmark need. Choosing the SDK allocator avoids adding an allocator implementation to this spike.
No binaryen pass is used.

The standalone wasm imports nothing. `src/host.c` supplies the C library's process/stdio bridge:
no command-line arguments, unsupported I/O and entropy return WASI errors, exit traps. The parser
uses none of those services during successful operation. A bounds/allocator abort stays a wasm
trap. The wasm ABI and `js/index.js` / `js/index.d.ts` are unchanged.

### One tree-sitter runtime

**Possible with a host export change; not a drop-in replacement for stock web-tree-sitter.**
The [minimal experiment](../experiments/side-module/README.md) loads the real grammar and cmark
inline code in one PIC side module through web-tree-sitter 0.27.0. The host parses a block and
JS calls the inline function on the same module using host-allocated memory. It passes.

The full resolver side module omits tree-sitter's runtime. It loads, but its first call fails
because stock web-tree-sitter exports JS wrapper APIs, leaving 19 raw C APIs unresolved.
The source and executable export audit agree. Rebuilding the host with those exports and exposing
the side module's resolver exports would allow one runtime and one memory; no tree transfer to
JS is required. Headers/runtime versions must match.

The unresolved full side artifact is 233,031 bytes raw / 75,300 gzip. That is not the final combined
payload: the host's additional exports retain code and must also be measured. The duplicate
roughly 96 KB runtime can go, but combined gzip, cold load and the performance of that rebuilt
host remain unconfirmed. The full integration was outside the authorized spike.

### Reproduction and remaining scope

`npm run build`, `npm test`, `sh scripts/check-native.sh`, then, in a heavy-run slot:

```sh
CHAT=/path/to/private-chat.json node scripts/check-gates.mjs
bash scripts/compare-builds.sh /path/to/rust-baseline /path/to/results
node scripts/summarize.mjs /path/to/results
```

A Rust baseline can be rebuilt from `4214f0c` in a separate worktree. Rust source, Cargo files,
pulldown-cmark, the markdown-rs port and their obsolete notices have been removed from this branch.
The MIT notice is corrected and the cmark/GFM/libc notices are included. The four existing spec
failures, public CI wiring, publishing, the supported shared-runtime host and Editor integration
remain outside this first step. No Plan 189 work was started.

### Review fixes and current artifact

Self-review found autolink cases outside the original corpus: single-character hosts, uppercase
`WWW`, bracket boundaries and overlapping email records in `a@b.com@c.com`. These now have
regression tests. The repository gate now checks every normalized mismatch against a Rust-derived
fixture of document hashes and exact construct ranges. An improvement can no longer offset a new
mismatch of the same kind. Its tests cover that cancellation case and duplicate differences.

The current artifact passes all 11 focused tests, 2,000 native ASan/UBSan edits, 672/676 spec cases
with unchanged section scores, 183/183 chat messages, and the exact gate over 497 repository docs.
The 11,000-edit and 300-edit fuzz runs have zero failures; the control still fails 10/10 checks.
The following fresh paired measurements supersede the earlier speed and size tables for the
current artifact. Raw output is in [`measurements/c-resolver-review/`](measurements/c-resolver-review/).
The recovered Rust wasm's hash matches the independently built baseline above. Benchmark scripts
are unchanged, with nine runs per case over three paired rounds.

| Milliseconds | Rust 46 KB | C 46 KB | Rust 1 MB | C 1 MB |
| --- | ---: | ---: | ---: | ---: |
| First frame, 60 rows | 0.397 | 0.314 | 0.373 | 0.337 |
| Full block parse | 1.460 | 1.382 | 26.506 | 26.731 |
| Decorate whole document | 1.100 | 0.800 | 16.500 | 11.800 |
| Keystroke median | 0.079 | 0.065 | 0.459 | 0.438 |
| Keystroke p95 | 0.148 | 0.129 | 0.967 | 0.891 |
| First keystroke after idle reparse | 0.443 | 0.367 | 1.593 | 1.651 |
| First keystroke without idle reparse | 0.442 | 0.365 | 2.405 | 2.364 |

All four keystroke median/p95 gates pass. The 1 MB full parse and first keystroke after idle
reparse were slightly slower than Rust in these runs; the table reports those results directly.

| Current C build | Raw bytes | Gzip -9 bytes |
| --- | ---: | ---: |
| O3 + LTO | 377,675 | 129,793 |
| Oz + LTO | 292,837 | 107,543 |

Memory growth is unchanged: Rust/C fully decorated 46 KB both use 0.56 MiB, and at 1 MB use
8.44/7.88 MiB. Parsed/viewport growth at 1 MB remains 7.50/7.25 MiB.

| Chromium milliseconds | Rust | C |
| --- | ---: | ---: |
| 46 KB load | 2.6 | 2.2 |
| 46 KB cold first frame | 6.9 | 7.6 |
| 1 MB load | 2.4 | 2.0 |
| 1 MB cold first frame | 9.7 | 7.9 |
| 1 MB warm full parse | 32.3 | 31.2 |

The 46 KB cold first-frame regression remains visible. The side-module experiment and its
unconfirmed rebuilt-host size/performance are unchanged by these resolver fixes.
