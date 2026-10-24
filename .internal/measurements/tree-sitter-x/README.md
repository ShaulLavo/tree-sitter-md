# Running inside tree-sitter-x

The resolver used to ship with its own copy of the tree-sitter runtime. Now it is a
[tree-sitter-x](https://github.com/ShaulLavo/tree-sitter-x) extension: a side module that
calls the host runtime's tree-sitter C API and libc, in the same memory as every other language.
The grammar is a standard tree-sitter language loaded by that runtime. The C code is the
single-module code from `dd5b629` with one change: `tsmd_new` takes the host's `TSLanguage`.

## Sizes

| File | Raw | Gzip |
| --- | ---: | ---: |
| `tree-sitter-md.wasm` (resolver) | 121,284 | 54,897 |
| `tree-sitter-markdown.wasm` (grammar) | 104,296 | 20,040 |
| Old single module, runtime included | 378,372 | 130,070 |

## Correctness

Identical output to the single module: `experiments/perf-next/stress.mjs` (7,680 edits, 261,936
comparisons, the same 120 incremental/fresh discrepancies both builds already had), 1,500 random
edits and 600 viewports on `agents.md` and `big.md` (10,832 comparisons), the spec (every example
unchanged, 672/676), chat 183/183, the 497-document repository gate, three fuzz seeds, and
`bench/cursor-seek.mjs --check`. `npm test` 109/109, native ASan/UBSan tests pass against
tree-sitter-x's `lib/`.

The first benchmark run crashed on 32-level nested quotes: the resolver runs on the runtime's
stack, 64 KB by default. tree-sitter-x now links a 1 MB stack, as the single module had;
`tests/resolver.mjs` covers 128 levels. Both builds still fail at 256 levels.

## Speed

Node 22.22.2, 4-core container, four alternating rounds of `experiments/perf-next`, medians of
per-round medians, milliseconds.

| Workload | Old bundle median | Extension median | Change | Old bundle p95 | Extension p95 | Extension faster rounds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| refs-500 | 1.6113 | 1.6893 | 4.8% | 2.2387 | 2.8213 | 0/4 |
| refs-2000 | 7.4409 | 7.5200 | 1.1% | 11.5825 | 9.9923 | 1/4 |
| table-1000 | 2.5189 | 2.7888 | 10.7% | 3.3917 | 4.6286 | 0/4 |
| continuations-1000 | 2.8863 | 2.8353 | -1.8% | 4.5527 | 4.1583 | 3/4 |
| ascii-paragraph-64k | 3.8092 | 4.0151 | 5.4% | 5.2107 | 6.0530 | 1/4 |
| unicode-paragraph | 3.8679 | 4.1107 | 6.3% | 5.6923 | 6.1748 | 1/4 |
| hebrew-first-line | 3.8586 | 3.6719 | -4.8% | 6.3742 | 5.6624 | 3/4 |
| mixed-lines | 4.1269 | 4.1901 | 1.5% | 5.8164 | 6.4203 | 2/4 |
| decorate-agents.md | 1.0684 | 1.1981 | 12.1% | 1.2804 | 1.6212 | 1/4 |
| decorate-big.md | 18.0299 | 20.0327 | 11.1% | 23.7336 | 26.0362 | 0/4 |
| encoding-ascii | 3.2008 | 3.3466 | 4.6% | 4.3064 | 4.5822 | 1/4 |
| encoding-hebrew | 3.8613 | 3.8811 | 0.5% | 5.7761 | 6.1894 | 1/4 |
| encoding-chinese | 4.2111 | 4.7309 | 12.3% | 5.6280 | 7.1127 | 0/4 |
| encoding-emoji | 2.4376 | 2.5775 | 5.7% | 3.6353 | 3.7659 | 0/4 |
| agents.md | 0.1806 | 0.1800 | -0.3% | 0.3882 | 0.3485 | 1/4 |
| big.md | 0.6456 | 0.6838 | 5.9% | 1.2423 | 1.3921 | 0/4 |
| nested-quotes | 0.3394 | 0.3917 | 15.4% | 0.5159 | 0.7306 | 0/4 |
| warm-agents.md | 0.1170 | 0.1264 | 8.0% | 0.2228 | 0.2116 | 1/4 |
| warm-big.md | 0.6459 | 0.6412 | -0.7% | 1.3767 | 1.3590 | 4/4 |

Keystrokes cost the same as the single module within noise. Some bulk workloads are 5-15% slower,
consistent with calls into the runtime crossing a module boundary instead of being inlined across
one link. Parsing through stock web-tree-sitter instead (`docs/measurements/web-tree-sitter` on
the `split/web-tree-sitter` branch) cost 2.5-3.5x.
