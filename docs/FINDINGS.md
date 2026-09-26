# Spike findings: custom tree-sitter grammar + Rust inline resolver (2026-09-26)

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
