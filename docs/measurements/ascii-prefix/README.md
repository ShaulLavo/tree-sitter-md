# ASCII-prefix conversion experiment

## Scope and decision

One isolated optimization in `src/leaf.c`: batch contiguous positive ASCII into the UTF-8 and source-position buffers, reserving once per run. A line containing a non-ASCII code unit or NUL goes through the original scalar conversion loop from that point to the end of the line, then batching resumes on the next line. Parsing, reference invalidation, cache keys, the grammar and the JS API are unchanged.

The first revision (`5b21d23`, measured in CI below) delegated the whole remainder of the source segment to the scalar loop, so one non-ASCII character early in a paragraph disabled batching for every later line. The current revision returns from the scalar loop at each newline, which it already tested for, so pure Unicode text runs the same instructions per character. See [Per-line revision](#per-line-revision).

Selected for a focused performance review because whole-document decoration and several large-leaf workloads improve consistently. **This is not a universal speedup:** the short 46 KB typing benchmark has a higher aggregate p95, and the mixed-Unicode paragraph is slightly slower. No merge or automatic approval is implied.

This version supersedes an earlier ASCII-run implementation that checked ASCII eligibility inside every Unicode iteration. Independent pure-Unicode benchmarks found a 3-8% slowdown in that implementation; it is not included here. This branch is based on the merged cursor improvement, and does not restore the removed one-off cursor validation workflow.

## Per-line revision

The first revision stopped batching at the first non-ASCII code unit or NUL in a segment, and a segment can be a whole paragraph. This revision hands control back to the batching loop after each newline the scalar loop converts. The scalar loop already tested every character for `\n`, so text with no ASCII runs executes the same per-character work. The batching loop keeps one index for the UTF-8, start and end arrays. Separate indexes measured about 10% slower on pure ASCII, so an `assert` in native builds guards the invariant instead.

These measurements come from a 4-core cloud container, not the GitHub-hosted runner used above. The CI validation run has not been repeated for this revision.

### Identities

- First revision: `5b21d231860225a1d8bfd4c8bd3e8c1d98bbe793`.
- Rebuilding baseline `680433b` with WASI SDK 34 in this container reproduced its checked-in WASM byte for byte (`5aa77017…`), so the vendored runtime and toolchain match.
- Per-line WASM SHA-256: `d7738b2e8e2c2fb5199f5556516fe973a6e1603fb4faa3f3d08ac910f7e15ec1`; Git blob `f6b7c80d04deee6bf438ccb2a711f1bcea94244d`.
- Per-line `src/leaf.c` Git blob: `4b4188fb2eb88e695e36c396baea18abc1f97dcb`.
- WASM raw 378,372 bytes and gzip -9 130,070 bytes, against 378,381 and 130,075 for the first revision.

### Leaf conversion alone

Native clang `-O3 -DNDEBUG`, `leaf_single` over an 8,000-line block, best of 200 conversions in each of five alternating rounds. This isolates the changed function from parsing and decoration.

| Input (8,000 lines) | Baseline ms | First revision ms | Per-line revision ms | vs baseline | vs first revision |
| --- | ---: | ---: | ---: | ---: | ---: |
| pure ASCII | 1.645 | 0.568 | 0.589 | -64.2% | 3.6% |
| pure Hebrew | 2.746 | 2.770 | 2.715 | -1.2% | -2.0% |
| pure Chinese | 3.744 | 3.767 | 3.743 | -0.1% | -0.7% |
| pure emoji | 2.040 | 2.192 | 2.029 | -0.5% | -7.4% |
| Hebrew on first line only | 1.611 | 1.669 | 0.556 | -65.5% | -66.7% |
| Hebrew on every other line | 1.952 | 2.053 | 1.383 | -29.1% | -32.6% |
| Hebrew at start of every line | 2.203 | 2.386 | 2.161 | -1.9% | -9.4% |

Pure ASCII runs the same batching loop in both revisions; 3.6% is within the round-to-round spread seen for that row.

### End-to-end Node timings

Node 22.22.2, four alternating rounds of the `experiments/perf-next` scripts, first revision against per-line revision. `hebrew-first-line` and `mixed-lines` are new `bench-targets.mjs` cases: a paragraph whose first line has Hebrew, and one alternating Hebrew and ASCII lines.

| Workload | First revision median | Per-line median | Change | First revision p95 | Per-line p95 | Per-line faster rounds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| refs-500 | 1.4246 | 1.2805 | -10.1% | 2.1494 | 1.8509 | 4/4 |
| refs-2000 | 6.9049 | 6.9665 | 0.9% | 8.9267 | 8.5463 | 2/4 |
| table-1000 | 2.2291 | 2.1123 | -5.2% | 3.3966 | 2.4663 | 4/4 |
| continuations-1000 | 2.4582 | 2.3322 | -5.1% | 2.9637 | 2.7366 | 3/4 |
| ascii-paragraph-64k | 3.2941 | 3.0651 | -7.0% | 3.9092 | 4.2693 | 3/4 |
| unicode-paragraph | 3.3040 | 3.3072 | 0.1% | 4.3698 | 3.8331 | 2/4 |
| hebrew-first-line | 3.4979 | 3.2961 | -5.8% | 4.5130 | 4.5530 | 2/4 |
| mixed-lines | 3.5082 | 3.3267 | -5.2% | 4.2554 | 3.6775 | 3/4 |
| decorate-agents.md | 0.7333 | 0.8418 | 14.8% | 0.7853 | 0.9506 | 1/4 |
| decorate-big.md | 14.0420 | 13.7219 | -2.3% | 18.8361 | 16.2516 | 3/4 |
| encoding-ascii | 2.6590 | 2.6425 | -0.6% | 3.7077 | 3.3523 | 3/4 |
| encoding-hebrew | 3.0999 | 3.0863 | -0.4% | 4.3758 | 3.8019 | 2/4 |
| encoding-chinese | 3.5351 | 3.3933 | -4.0% | 4.0697 | 4.2476 | 2/4 |
| encoding-emoji | 1.9502 | 2.1653 | 11.0% | 2.2654 | 2.4454 | 0/4 |
| agents.md | 0.1376 | 0.1333 | -3.1% | 0.2833 | 0.2706 | 2/4 |
| big.md | 0.6112 | 0.6525 | 6.8% | 1.0673 | 1.1285 | 2/4 |
| nested-quotes | 0.2728 | 0.2759 | 1.2% | 0.3856 | 0.3201 | 2/4 |
| warm-agents.md | 0.0971 | 0.1029 | 6.0% | 0.1589 | 0.1666 | 1/4 |
| warm-big.md | 0.6156 | 0.5873 | -4.6% | 1.1652 | 1.1144 | 3/4 |

This container is too noisy to resolve these differences. Workloads with no non-ASCII text run identical conversion code in both builds, yet their medians moved by -10% to +15%. The mixed-script cases improved by about 5–6% end to end, less than the native result, because conversion is only part of an edit's cost. No end-to-end gain or loss is claimed from this table; repeating the six-round CI validation is the way to settle it.

### Correctness

All run on the per-line build in this container:

- JS/WASM tests: **108/108 passed**.
- `scripts/check-native.sh` under ASan/UBSan: 2,000 incremental edits; the leaf mapping oracle, now **30,000 slices plus 30,000 segmented blocks** that carry `line_start` across continuation gaps, with pure-ASCII, rare-Unicode and dense-Unicode inputs; cursor oracles **41,504 + 7,296 comparisons**. Three deliberately broken fast paths each failed the leaf oracle.
- CommonMark/GFM: **672/676**, every per-example outcome identical to baseline; failures remain 96, 98, 216, 260.
- `scripts/check-gates.mjs` with the pinned corpora: chat **183/183 identical**; repository gate **497 documents, no unexpected differences**, still 406/497 exact with 208 missing and 33 extra constructs.
- Three-seed differential fuzz: zero failures; negative control failed 10/10.
- `stress.mjs` against baseline: **7,680 edits / 261,936 comparisons**, zero changed outcomes; the same **120** pre-existing incremental/fresh discrepancies.
- `node bench/cursor-seek.mjs --check`: passed.

## Reproducible identities (first revision)

- Baseline: `680433b989ded6d633139614fd24514859200cc0`.
- Tested implementation commit: `5b21d231860225a1d8bfd4c8bd3e8c1d98bbe793`.
- [Completed validation run](https://github.com/ShaulLavo/tree-sitter-md/actions/runs/36274087199), job `108493356796`.
- [Raw validation artifact](https://github.com/ShaulLavo/tree-sitter-md/actions/runs/36274087199/artifacts/10917175296), SHA-256 `aa52adec10bc8b803d776d33c4baae93e13bb2c3ee5803a57a1f3f8fc5a52188`.
- Baseline WASM SHA-256: `5aa77017086601a52cdf90be24ae75d7eb73689cb4f9c463031fc10daa8feae7`.
- Candidate WASM SHA-256: `1b30724e440232155db6f6f30f9b4b2a95588768a4ee9268dc03282ec0630c0e`.
- Candidate WASM Git blob: `6410610213111c563bceb8de39656da2bb6234bf`.
- Candidate `src/leaf.c` Git blob: `7dff127c08c6ba0386b4bc289bba366be119cb23`.

The artifact digest and the committed source/WASM blob hashes were independently checked after downloading the evidence. The baseline also rebuilt byte-for-byte identically to its checked-in WASM. Node 26.7.0, hash-verified WASI SDK 34, `-O3` plus LTO; dependency lock and machine details are in the artifact.

## All paired timing results (first revision, CI)

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

## Independent runtime checks (first revision)

The downloaded candidate was tested against the same baseline in local Node 22.16.0 and Chromium 144.0.7559.96, rather than trusting branch labels alone.

A six-round Node 22 encoding check found ASCII elapsed time 13.3% lower, Hebrew 0.9% lower, Chinese 2.8% higher, and emoji 1.6% lower. This is another reason not to claim every Unicode workload is unchanged in timing.

Six alternating Chromium rounds reproduced the direction of larger gains: approximately 17% less elapsed time on its 1 MB typing case, 7% on a 1,000-row table, and 19% on a large ASCII paragraph. The small-document and Unicode-heavy medians were tied at the available timer resolution. Browser loading was in-memory, with unchanged JS write/read/document-method bodies. This was not a cold-load measurement; its 100-edit workload is not identical to the Node standard runner, and the browser clock resolution was approximately 0.1 ms. Small browser differences are inconclusive.

## Correctness results and explicit limitations (first revision)

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

## Size and memory (first revision)

| Artifact | Baseline | Candidate |
| --- | ---: | ---: |
| WASM raw bytes | 377,723 | 378,381 |
| WASM gzip -9 bytes | 129,845 | 130,075 |
| 46 KB fully decorated memory growth | 0.56 MiB | 0.56 MiB |
| 1 MB parsed/viewport memory growth | 7.25 MiB | 7.25 MiB |
| 1 MB fully decorated memory growth | 7.88 MiB | 7.88 MiB |

Memory is the existing harness's rounded linear-memory high-water growth, not live allocation size. Startup, cold compilation and end-to-end editor frame latency were not independently measured for this patch.

## Reproduction

Build with the pinned WASI SDK and run `npm test`, `sh scripts/check-native.sh` (which includes the leaf mapping oracle), and `node bench/cursor-seek.mjs --check`. With the pinned repository checkouts, set `PLATFORM` and `EDITOR_REPO`, then run `CHAT=bench/corpus/chat.json node scripts/check-gates.mjs`.

The scripts in `experiments/perf-next/` contain the standard, targeted, warmed, encoding, and comparative stress probes. The stress script takes baseline and candidate repository paths. Timing scripts take one build's root path; alternate build order across repeated runs. Compare one candidate at a time. This PR does not include the reference-map or cursor-walk performance experiments.
