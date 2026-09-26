# Experiment 1a: scanner capacity retention

**NOT APPROVED. No optimization PR opened. Main is unchanged.**

Only scanner allocation-capacity retention was tested. Byte-packed state and the remaining optimization ideas have not been tested. The sequence stops at this failed acceptance gate.

## Provenance

Baseline: `299aa70be62dfcb7e45896388e893b8a216a2f3c`.
Experiment/harness: `06971c1d152c516082af5f7237b20eda62a9dd42`.
Completed run: https://github.com/ShaulLavo/tree-sitter-md/actions/runs/36266471425
Artifact: `scanner-capacity-validation`, ID `10914367849`.
Original ZIP SHA-256: `3c897dfc477c30c98e0ed43158f1b915f68a50697af8b69a9982cbfc340afa3f`.

Remote: Ubuntu 24.04.5, Node 26.7.0, WASI SDK 34 / Clang 23.1.0, native Clang 18.1.3. Independent local checks: Node 22.16.0, native Clang 17.0.0.

Both WASMs were built with the unchanged repository `-O3` + LTO build script. Rebuilt baseline is byte-identical to the checked-in WASM. Production source and checked-in WASM on this experiment branch remain unchanged: the candidate exists as `scanner-capacity.patch`, applied only to an isolated copy by the workflow.

## Candidate correction

Retain `open_blocks.capacity` across scanner deserialization. Explicitly initialize capacity to zero in the constructor instead. Removing the deserialize reset alone is unsafe because construction uses malloc and relied on that reset. A poisoned-allocation negative control rejects the naive one-line patch; the measured candidate includes constructor initialization.

## Checks actually executed

| Check | Baseline | Candidate |
| --- | --- | --- |
| Focused WASM tests, Node 26 and independent Node 22 | 11/11 on each | 11/11 on each |
| Existing native ASan + UBSan with leak detection | 2,000 edits pass | 2,000 edits pass |
| CommonMark + GFM spec | 672/676 | 672/676 |
| Exact spec outcome comparison | All 676 per-example outcomes identical | All section floors retained |
| Fuzz, seeds 1, 7, 8675309 | 33,900 edits; 3,390 comparisons; zero failures | Same |
| Fuzz negative control | Rejects 10/10 intentionally mismatched comparisons | Same |
| Added real-scanner state/allocation tests | 300,000 transitions pass | 300,000 transitions pass |
| Added reference regression, GFM off/on | FAIL | FAIL |
| Added blank-line viewport regression, local Node 22, GFM off/on | FAIL | FAIL |
| Added native multi-API edit harness | FAIL: GFM off, depth 32, seed 1, step 17 | Same failure, preceding output trace byte-identical |
| Required private chat/repository corpus | NOT RUN: original inputs unavailable | NOT RUN |
| Browser performance | NOT RUN | NOT RUN |

The existing fuzz harness compares every tenth edit; do not report 33,900 individual comparisons. The added multi-API harness was designed for 3,600 edits but stopped on a failure, so that full suite is not claimed as passed. It compared decorations, highlights, folds, injections, and row metadata before reaching the failure.

The scanner-state tests run the actual scanner with three seeds, depths 0 through 128, exact serialization round trips, empty resets, push/pop, poisoned constructor allocation, and capacity/pointer/realloc checks. They passed both locally and remotely. Arbitrary generated scanner states are synthetic tests, not claims of reachable Markdown states.

## Six-round paired timings

Same remote runner; alternating AB/BA order. Milliseconds below are medians of the six per-run statistics; first keystroke excluded from each median/p95.

| Workload | Baseline median | Candidate median | Baseline p95 | Candidate p95 |
| --- | ---: | ---: | ---: | ---: |
| 46 KB agents.md | 0.164007 | 0.153797 | 0.422184 | 0.632822 |
| 1 MB big.md | 0.498135 | 0.503656 | 1.300880 | 1.310789 |
| Nested quotes | 0.372471 | 0.374069 | 0.408689 | 0.414244 |

Median paired percentage changes in keystroke median: +0.24%, +0.37%, +0.09%, respectively (positive means slower). Small-document p95 was worse in all six pairs, with a median paired change of +40.52%. Hosted-runner variability prevents a universal causal claim, but there is no convincing end-to-end speed win and no passed no-regression gate. The lower aggregate 46 KB median must not be presented as a confirmed speedup.

The harness constructs the next JS string and computes the viewport outside the edit/decorations timers. Each run checks final output against a fresh parse. Successful edit counts per run: 197, 200, 158. Both variants use identical seeds and edits. These measurements use a different harness and machine from FINDINGS.md; do not compare absolute numbers across those tables.

Synthetic scanner-state realloc calls: 332,934 baseline versus 6 candidate. That verifies allocation reuse, not whole-parser acceleration. Linear-memory high-water marks are unchanged: 7.25 MiB parsed/viewport and 7.88 MiB wholly decorated at 1 MB. Raw WASM stays 377,675 bytes; gzip changes from 129,793 to 129,799 bytes.

## Pre-existing correctness blocker: reference invalidation

Start with `[ref]\n>[ref]:o`, warm decorations, then `edit(6, 7, '\n')`. Final text is `[ref]\n\n[ref]:o`.

Incremental parsing loses the reference link; fresh parsing keeps it. This reproduces on the original checked-in WASM, both rebuilt WASMs, local Node 22, remote Node 26, and native C. This is not introduced by scanner capacity retention.

Incremental records: `[0,5,1,0,7,14,10,0]`.
Fresh records: `[0,5,1,0,0,5,16,0,1,4,39,0,7,14,10,0]`.

Native diagnostics show one definition source before the edit, zero after the incremental edit, and one on a fresh parse, despite matching tree shapes. No root-cause fix is included or claimed.

## Pre-existing correctness blocker: blank-line viewport

```js
const doc = new MarkdownDocument();
doc.setText('a\n\nb');
doc.decorations(2, 4);
```

Expected `[3,4,1,0]` for the following paragraph; actual `[]`. Baseline and candidate both fail with GFM on and off. The full-document query includes both paragraphs. This was independently checked locally after the completed remote run; it was not part of that CI run.

## Decision

Do not open a PR for this candidate. The additional correctness checks are red, the private gate is incomplete, and timing does not establish a benefit. No spec floor was lowered, no new failure marked expected/ignored, and no corpus result fabricated.

The original 183-message CHAT JSON and pinned Platform (`c130dd35a`) / Editor (`74e76be`) checkouts were unavailable. Full `scripts/check-gates.mjs` has not passed; no replacement corpus was substituted and no private data published. Remaining ideas are not tested or approved.

Run the preserved regressions with:

```sh
node experiments/perf/reference-invalidation.mjs /path/to/baseline
node experiments/perf/viewport-gap.mjs /path/to/baseline
WASM=/path/to/candidate.wasm node experiments/perf/reference-invalidation.mjs /path/to/baseline
WASM=/path/to/candidate.wasm node experiments/perf/viewport-gap.mjs /path/to/baseline
```

These scripts currently exit nonzero. The failed CI run preserves all evidence rather than treating missing mandatory data or a failing regression as success.
