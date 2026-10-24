# Review fixes evidence

This run measures the autolink fixes and exact repository-difference gate. It supersedes the
performance and artifact-size results in `../c-resolver/` for the current C wasm.

The Rust wasm was recovered from `4214f0c:tree-sitter-md.wasm`; its SHA-256 matches the independently
built Rust baseline recorded in `../c-resolver/size.json`. A disposable package with the unchanged
JS binding and benchmark scripts ran beside C through `scripts/compare-builds.sh`. Three paired
rounds reverse order in round two; each round runs `bench/run-all.sh` with three repetitions.
Chromium runs five cold contexts per case in each round. All heavy work used wave-heavy.

`summary.json` comes from `scripts/summarize.mjs`; `chromium-summary.json` contains the median of
three rounds. `size.json` identifies the measured O3 artifact and the separately compiled Oz
artifact. Native sanitizer and focused-test output is in `native-tests.txt`; complete correctness
results are in `c-checks.txt`. The private chat input is the same 183 messages recovered from the
read-only backup described in FINDINGS. No chat text is included.

`tests/repository-differences.json` was generated from the Rust baseline, using the same micromark
normalizer and pinned repository revisions as `bench/corpus.mjs`. It pins all 497 document names
and content hashes, plus each missing/extra construct's kind, range and extra fields. The gate
allows removal of known differences and rejects every new difference, including duplicates.
