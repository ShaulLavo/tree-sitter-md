# ASCII-prefix conversion experiment

## Scope and decision

One isolated optimization in `src/leaf.c`: batch contiguous positive ASCII into the UTF-8 and source-position buffers, reserving once per run. At the first non-ASCII code unit or NUL in a source segment, delegate the remainder to the original scalar conversion loop. Parsing, reference invalidation, cache keys, the grammar and the JS API are unchanged.

Selected for a focused performance review because whole-document decoration and several large-leaf workloads improve consistently. **This is not a universal speedup:** the short 46 KB typing benchmark has a higher aggregate p95, and the mixed-Unicode paragraph is slightly slower. No merge or automatic approval is implied.

This version supersedes an earlier ASCII-run implementation that checked ASCII eligibility inside every Unicode iteration. Independent pure-Unicode benchmarks found a 3-8% slowdown in that implementation; it is not included here. This branch is based on the merged cursor improvement, and does not restore the removed one-off cursor validation workflow.

## Reproducible identities

- Baseline: `680433b989ded6d633139614fd24514859200cc0`.
- Tested implementation commit: `5b21d231860225a1d8bfd4c8bd3e8c1d98bbe793`.
- [Completed validation run](https://github.com/ShaulLavo/tree-sitter-md/actions/runs/36274087199), job `108493356796`.
- [Raw validation artifact](https://github.com/ShaulLavo/tree-sitter-md/actions/runs/36274087199/artifacts/10917175296), SHA-256 `aa52adec10bc8b803d776d33c4baae93e13bb2c3ee5803a57a1f3f8fc5a52188`.
- Baseline WASM SHA-256: `5aa77017086601a52cdf90be24ae75d7eb73689cb4f9c463031fc10daa8feae7`.
- Candidate WASM SHA-256: `1b30724e440232155db6f6f30f9b4b2a95588768a4ee9268dc03282ec0630c0e`.
- Candidate WASM Git blob: `6410610213111c563bceb8de39656da2bb6234bf`.
- Candidate `src/leaf.c` Git blob: `7dff127c08c6ba0386b4bc289bba366be119cb23`.

The artifact digest and the committed source/WASM blob hashes were independently checked after downloading the evidence. The baseline also rebuilt byte-for-byte identically to its checked-in WASM. Node 26.7.0, hash-verified WASI SDK 34, `-O3` plus LTO; dependency lock and machine details are in the artifact.

## All paired timing results

Milliseconds; lower is better. Six alternating baseline/candidate rounds on the same GitHub-hosted runner. Each displayed value is the median of the six per-run medians or p95s, not a pooled percentile. Negative percentages mean lower elapsed time. `Faster rounds` counts lower per-run median values.

The standard runner uses 200 seeded edits and a 60-row request, with JS string reconstruction outside the measured region. The synthetic targeted runner uses 100 after-anchor insertions, excludes the first five, and also requests 60 rows. Full-decoration measurements parse before starting the timer. Warm typing uses 800 warm-up edits and 400 measured edits. Encoding cases use 150 near-end insertions, exclude the first 50, and decorate the whole paragraph. All benchmark runs check the final incremental result against a fresh parse.

| Workload | Baseline median | Candidate median | Change | Baseline p95 | Candidate p95 | p95 change | Faster rounds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 46 KB standard typing | 0.1475 | 0.1460 | -1.0% | 0.3759 | 0.4362 | +16.0% | 3/6 |
| 1 MB standard typing | 0.4935 | 0.4593 | -6.9% | 1.2820 | 1.0584 | -17.4% | 6/6 |
| Nested quotes | 0.3716 | 0.3696 | -0.6% | 0.4071 | 0.4061 | -0.2% | 4/6 |
| 500 reference definitions | 1.5542 | 1.5442 | -0.6% | 2.3456 | 1.9018 | -18.9% | 3/6 |
| 2,000 reference definitions | 6.2657 | 6.2443 | -0.3% | 6.3883 | 6.3582 | -0.5% | 4/6 |
| 1,000 table rows | 2.7854 | 2.5418 | -8.7% | 2.8420 | 2.6005 | -8.5% | 6/6 |
| 1,000 quote continuation lines | 3.0740 | 2.7590 | -10.2% | 3.1631 | 2.8247 | -10.7% | 6/6 |
| 64 KB ASCII paragraph | 3.7436 | 3.1304 | -16.4% | 3.8660 | 3.2245 | -16.6% | 6/6 |
| Mixed-Unicode paragraph | 3.3254 | 3.3682 | +1.3% | 3.3863 | 3.4475 | +1.8% | 1/6 |
| Full decoration, 46 KB | 1.2710 | 0.9058 | -28.7% | 1.2990 | 0.9613 | -26.0% | 6/6 |
| Full decoration, 1 MB | 20.3186 | 14.9735 | -26.3% | 21.2026 | 15.0945 | -28.8% | 6/6 |
| Warm typing, 46 KB | 0.1122 | 0.1080 | -3.7% | 0.1907 | 0.1596 | -16.3% | 5/6 |
| Warm typing, 1 MB | 0.4458 | 0.4388 | -1.6% | 1.3641 | 1.1316 | -17.0% | 3/6 |
| ASCII-dominant encoding case | 3.1046 | 2.5790 | -16.9% | 3.2848 | 2.7630 | -15.9% | 6/6 |
| Hebrew-dominant encoding case | 3.1670 | 3.1803 | +0.4% | 3.4013 | 3.3707 | -0.9% | 1/6 |
| Chinese-dominant encoding case | 3.5880 | 3.5861 | -0.1% | 3.8312 | 3.6872 | -3.8% | 4/6 |
| Emoji-dominant encoding case | 2.0646 | 2.0465 | -0.9% | 2.2526 | 2.1444 | -4.8% | 4/6 |

The 46 KB short-run p95 improved in three rounds and worsened in three. Its aggregate is nevertheless 16% higher and is retained above, not dismissed as noise. The warmed 1 MB median is only 1.6% lower and wins three rounds; it is not evidence of a large universal steady-state gain. No statistical significance is asserted for small differences.

## Independent runtime checks

The downloaded candidate was tested against the same baseline in local Node 22.16.0 and Chromium 144.0.7559.96, rather than trusting branch labels alone.

A six-round Node 22 encoding check found ASCII elapsed time 13.3% lower, Hebrew 0.9% lower, Chinese 2.8% higher, and emoji 1.6% lower. This is another reason not to claim every Unicode workload is unchanged in timing.

Six alternating Chromium rounds reproduced the direction of larger gains: approximately 17% less elapsed time on its 1 MB typing case, 7% on a 1,000-row table, and 19% on a large ASCII paragraph. The small-document and Unicode-heavy medians were tied at the available timer resolution. Browser loading was in-memory, with unchanged JS write/read/document-method bodies. This was not a cold-load measurement; its 100-edit workload is not identical to the Node standard runner, and the browser clock resolution was approximately 0.1 ms. Small browser differences are inconclusive.

## Correctness results and explicit limitations

Both builds ran the original gates and additional checks before the implementation branch was published:

- Existing JS/WASM tests: **108/108 passed**.
- Original native ASan/UBSan and leak checks: **2,000 incremental edits passed**.
- Cursor oracles: **41,504 comparisons plus 7,296 large-nested comparisons passed**.
- New scalar mapping oracle under ASan/UBSan: **20,000 UTF-16 slices**, with exact UTF-8 bytes and every source-start/source-end entry compared. Includes ASCII, NUL, CR/LF, tabs, Hebrew, Chinese, and paired/unpaired surrogates.
- New merged-main blank-line viewport cost guard: passed.
- CommonMark/GFM: **672/676**, all per-example results identical. The existing failures remain **96, 98, 216, 260**.
- Original chat corpus: **183/183 identical**, 859 normalized constructs.
- Pinned repository gate: all **497 input hashes and exact difference allowlists passed**. This means no unexpected differences, not 497 exact micromark matches: **406/497** remain identical, with the existing 208 missing and 33 extra constructs unchanged.
- Original differential fuzz: **11,000 edits at 46 KB and 300 at 1 MB**, zero mismatches.
- Three-seed differential fuzz: **33,900 edit operations / 3,390 checks per build**, zero mismatches. Seed 1 repeats the original gate and is not independent additional coverage.
- Deliberately corrupted negative control: failed **10/10**, as intended.
- Additional mutation/undo probe: **7,680 edits / 261,936 comparisons**, zero changed outcomes between candidate and baseline. **120 pre-existing incremental/fresh query discrepancies remain on both builds.** These are recorded as failures of fresh/incremental equivalence, not relabeled as successful fresh-parse comparisons, and are not necessarily 120 distinct bugs.

Independent local reruns of the downloaded candidate passed all 108 JS tests and repeated the 7,680-edit / 261,936-comparison probe with identical results, including the same 120 baseline discrepancies. Browser benchmark final states also matched their fresh parses.

Original corpus sources are `ShaulLavo/fregat` at `c130dd35a202dd06ccd160bd5ed0789c889315c2` and `ShaulLavo/singapore` at `74e76bef2af674ad80b3c13024fa47f692e2bb7c`. Bundled chat SHA-256: `2c5c01ed08af3c921c8c500b6c9f50d9e48d39480bedc91355dc88377e9adbf1`.

## Size and memory

| Artifact | Baseline | Candidate |
| --- | ---: | ---: |
| WASM raw bytes | 377,723 | 378,381 |
| WASM gzip -9 bytes | 129,845 | 130,075 |
| 46 KB fully decorated memory growth | 0.56 MiB | 0.56 MiB |
| 1 MB parsed/viewport memory growth | 7.25 MiB | 7.25 MiB |
| 1 MB fully decorated memory growth | 7.88 MiB | 7.88 MiB |

Memory is the existing harness's rounded linear-memory high-water growth, not live allocation size. Startup, cold compilation and end-to-end editor frame latency were not independently measured for this patch.

## Reproduction

Build with the pinned WASI SDK and run `npm test`, `sh scripts/check-native.sh`, `sh scripts/check-perf-native.sh`, and `node bench/cursor-seek.mjs --check`. With the pinned repository checkouts, set `PLATFORM` and `EDITOR_REPO`, then run `CHAT=bench/corpus/chat.json node scripts/check-gates.mjs`.

The scripts in `experiments/perf-next/` contain the standard, targeted, warmed, encoding, and comparative stress probes. The stress script takes baseline and candidate repository paths. Timing scripts take one build's root path; alternate build order across repeated runs. Compare one candidate at a time. This PR does not include the reference-map or cursor-walk performance experiments.
