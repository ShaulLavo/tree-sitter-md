# Parsing with the host's web-tree-sitter

## Question

Can the grammar ship as a standard tree-sitter language, loaded by the web-tree-sitter the editor
already runs, with only the inline resolver as our own wasm, and no tree-sitter runtime of ours?

## What changed

- `tree-sitter-markdown.wasm`: the grammar built by the tree-sitter CLI, loaded with `Language.load`.
  107,009 bytes raw, 20,403 gzip. It imports its allocator from web-tree-sitter.
- `tree-sitter-md.wasm`: cmark inline pass, definitions, per-leaf cache and highlight derivation;
  no tree-sitter runtime, no imports. 132,018 bytes raw, 58,651 gzip (the single module was
  378,372 / 130,070).
- `js/index.js` parses through web-tree-sitter and walks the tree: `descendantsOfType` once per
  range, records emitted in the old order, leaf blocks passed to the resolver as ranges. The
  parser reads text from the resolver's memory in 5,119-unit chunks.
- `vendor/tree-sitter/`, its cursor patch and `tests/cursor-seek.c` are gone. `tests/native.c` drives
  the resolver under ASan/UBSan with a stand-in block splitter.

## Correctness

Outputs are identical to the single-module build (`dd5b629`):

- `experiments/perf-next/stress.mjs` old against new: 7,680 edits, 261,936 comparisons, zero
  differences; the same 120 incremental/fresh discrepancies both builds already had.
- 1,500 random edits and 600 random viewports (half starting in blank lines) on `agents.md` and
  `big.md`, both GFM modes: 10,832 comparisons of decorations, highlights, folds and injections,
  zero differences.
- `npm test` 108/108. Spec 672/676 with every example's outcome equal to baseline. Chat 183/183.
  Repository gate: 497 documents, no unexpected differences. Three fuzz seeds, zero failures;
  negative control fails 10/10. `bench/cursor-seek.mjs --check` passes.
- Native: 4,000 incremental edits agree with fresh documents; disabling definition invalidation or
  `tsmd_forget` each fails the test.

Two stock tree-sitter seek bugs showed up and are avoided rather than patched: both
`ts_tree_cursor_goto_first_child_for_byte` and `ts_node_first_child_for_byte` miss the next block
when the goal is in a hidden node's trailing blank lines, and web-tree-sitter 0.27's
`TreeCursor#gotoFirstChildForIndex` reads its goal from the wrong transfer-buffer slot.

## Speed

Node 22.22.2, 4-core cloud container, four alternating rounds of `experiments/perf-next`,
milliseconds, medians of per-round medians. Unlike the ASCII-prefix measurements, these
differences are far larger than the container's noise: the split build lost almost every round.

| Workload | Old bundle median | Split median | Change | Old bundle p95 | Split p95 | Split faster rounds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| refs-500 | 1.4900 | 2.0366 | 36.7% | 2.2047 | 3.3357 | 0/4 |
| refs-2000 | 7.3905 | 7.5121 | 1.6% | 11.0458 | 10.4653 | 1/4 |
| table-1000 | 2.3911 | 4.0381 | 68.9% | 2.5308 | 6.0810 | 0/4 |
| continuations-1000 | 2.6832 | 4.0779 | 52.0% | 3.9413 | 6.5036 | 0/4 |
| ascii-paragraph-64k | 3.6721 | 5.4306 | 47.9% | 5.8430 | 8.3820 | 0/4 |
| unicode-paragraph | 3.8905 | 5.2395 | 34.7% | 5.3433 | 6.7153 | 0/4 |
| hebrew-first-line | 3.4995 | 3.9022 | 11.5% | 5.1773 | 4.6899 | 0/4 |
| mixed-lines | 3.8068 | 4.1426 | 8.8% | 5.8361 | 5.8747 | 1/4 |
| decorate-agents.md | 1.0264 | 2.3761 | 131.5% | 1.3964 | 2.9521 | 0/4 |
| decorate-big.md | 17.7018 | 29.4042 | 66.1% | 27.8614 | 34.9865 | 0/4 |
| encoding-ascii | 3.1202 | 4.8047 | 54.0% | 5.1985 | 6.2645 | 0/4 |
| encoding-hebrew | 3.6524 | 5.0097 | 37.2% | 5.3651 | 6.5712 | 0/4 |
| encoding-chinese | 4.1506 | 5.3831 | 29.7% | 5.9669 | 7.0388 | 0/4 |
| encoding-emoji | 2.3727 | 3.4141 | 43.9% | 3.9965 | 4.6404 | 0/4 |
| agents.md | 0.1620 | 0.4293 | 165.1% | 0.3533 | 0.8445 | 0/4 |
| big.md | 0.6307 | 1.6716 | 165.0% | 1.1838 | 2.5867 | 0/4 |
| nested-quotes | 0.3385 | 0.8287 | 144.8% | 0.5409 | 1.1888 | 0/4 |
| warm-agents.md | 0.1088 | 0.3750 | 244.8% | 0.1801 | 0.5483 | 0/4 |
| warm-big.md | 0.5922 | 1.5671 | 164.6% | 1.3057 | 2.4346 | 0/4 |

Per keystroke the split build costs about 2.5-3.5x: 0.11 -> 0.38 ms on the 46 KB document and
0.59 -> 1.57 ms at 1 MB, warmed. Profiles of the 1 MB warm run:

- Reparse is about 2x slower for the same grammar and runtime version (0.3 -> 0.6 ms on identical
  edits). web-tree-sitter reads text through a JS callback in 10 KB chunks; the single module parsed
  its own memory. A full parse costs about the same (72 vs 78 ms for 1 MB).
- Every tree access from JS is a JS-to-wasm call that marshals a node and allocates a `Node`; object
  creation and marshalling were about a third of decoration time. Walking leaf children is most of
  the rest. One `descendantsOfType` call per range beat per-sibling seeks; one per leaf was slower
  than child loops, since each call scans every symbol in the language.

Chromium 144, five cold loads (`bench/chromium.mjs`), milliseconds:

| | Load | First frame | Full parse, 1 MB | Warm full parse, 1 MB |
| --- | ---: | ---: | ---: | ---: |
| Single module | 5.6-6.2 | 13-18.7 | 94 | 66.9 |
| Split | 16.6-17.5 | 16.8-18.3 | 100.7 | 94.4 |

Load includes initializing web-tree-sitter itself, which an editor that already highlights other
languages has paid.

## Memory

web-tree-sitter starts with a 32 MB heap, so one tree shows no growth there; parsing `big.md`
repeatedly put each 1 MB document's tree at about 6 MB of it. The resolver grew 2.0 MB (parsed) to
2.7 MB (fully decorated) for `big.md`. Together that is about the 7.3-7.9 MB of the single module.

## Reading

Standard pieces work and stay exactly correct, but stock web-tree-sitter's JS layer costs
2.5-3.5x per keystroke. The two big costs, text through a JS callback and a JS call per node, are
inside web-tree-sitter; removing them means changing it (a fork, or upstream API for parsing from
wasm memory and for handing a tree to another module), not this repository.
