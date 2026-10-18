# Streaming qualification and presentation baseline

Run these commands from the repository root with Node 26 or later, installed root
and `bench` dependencies, and both built Wasm modules. Build and browser
prerequisites are in the [development guide](development.md#build).

## Run exhaustive snapshot qualification

```sh
mkdir -p target/reports
node --test tests/streaming-qualification.mjs tests/presentation-lifetime.mjs
node scripts/check-streaming-qualification.mjs > target/reports/streaming-qualification.json
```

`npm test` also selects both test entries. `bun run streaming:qualification` runs
the report command. CI retains its JSON as the `streaming-qualification` artifact.
The report exits `0` for `READY`, `1` for comparison failures, or `2` for missing
presentation checks. It records artifact hashes, runtime pins, corpus provenance,
schedule seeds, required counts, failures, and bounded failure witnesses.

The matrix uses all 33 original fixtures and their 76 independently authored
checkpoints. Every UTF-16 prefix and two-chunk boundary receives fresh and edited
exact, open, and ended reads. Eight fixed-seed schedules cover each selected
message from the pinned 183-message chat corpus and each selected document from
the pinned 497-document repository corpus. The selection contains 16 chat messages
and three repository documents. The authored oracle remains a separate comparison.

The lifetime fixture names delivery events such as pause, retryable failure,
cancellation, and permanent failure. The parser API has no delivery-state
object, so those cases exercise the caller's repeated `open` or `ended` reads,
resume and undo edits, source replacement, retained snapshots, and disposal.
They do not test a provider transport.

Local proof recorded on 2026-10-18 has these results. The execution coordinator
retains the full reports named below; CI publishes subsequent exhaustive reports
as the `streaming-qualification` artifact.

| Evidence | Executed result |
| --- | --- |
| `qualification.json` | `READY`; 467 UTF-16 prefixes, 467 two-chunk boundaries, and 2,312 corpus checkpoints |
| `qualification.json` | 4,180 exact and 8,360 presentation comparisons passed, with no failures or missing checks |
| `qualification.json` | Independent authored oracle passed 1,147 exact and 364 presentation checks |
| `qualification-tests.log` | 21 tests passed, with no failures or skips, including lifecycle and corruption controls |
| `native.log` | ASan/UBSan checks passed; 2,000 incremental edits, 30,000 leaf slices, 30,000 segmented blocks, and cursor oracles with 41,504 and 7,296 comparisons |
| `native-allocation.log` | The supported native `reserve` allocation-abort contract passed in an owned child; default cmark/tree-sitter allocators have no injection hook |

Packed Node, Bun, and production Vite/Chromium consumers run through
`bun run test:package`. The checks cover initialization order, exact and presentation
snapshots, unchanged-revision mode transitions, source replacement, independent
documents, UTF-16 fidelity, explicit memory growth, and retained results after
edits and disposal. `bun run test:browser` separately exercises the resizable host
heap.

All nine packed runtime and initialization-order combinations passed. Each
performed two explicit memory growths and retained three lifecycle snapshots.
The dedicated browser suite passed in Chromium 153 with resizable memory, the
expected rejection of a direct `TextDecoder` read from that buffer, four explicit
memory growths, and a retained semantic snapshot of 323 serialized code units.
The remaining local release gates also passed:

| Gate | Executed result |
| --- | --- |
| `npm test` | 1,791 tests passed, no failures |
| `bun run test:types` | Public presentation type checks passed |
| `bun run check` | 676 official spec cases and 183 chat fixtures passed; the 497-document pinned repository corpus had no unexpected differences |
| `bun run check` | 11,300 fuzz edits had no failures; all 10 negative controls failed as expected |

CI verification remains pending.

## Record a bounded complete-document baseline

```sh
node bench/presentation.mjs --list
node bench/presentation.mjs --case chat-median --samples 1 --warmup 0 > target/reports/presentation-smoke.json
node bench/presentation.mjs --samples 5 --warmup 1 > target/reports/presentation-baseline.json
```

`bun run bench:presentation` runs the same tool. Each selected case runs sequentially
in a fresh Node process with explicit garbage collection. `--case ID` can repeat
to select several cases. The default deadline is 120 seconds per case and
`--timeout-ms` accepts 1,000 through 300,000 milliseconds. Progress goes to stderr;
the JSON report goes to stdout. The command stops its worker on timeout or
interruption and creates no servers or scratch directories.

The eight cases cover median, 90th-percentile, and longest committed chat messages,
a 32 KiB structured response, two 256 KiB documents, 2,048 late references, and 64
quote levels. Every input is bounded to 256 KiB. The report records input hashes,
options, runtime and artifact identities, complete-document `setText`, `semantics`,
open presentation, and ended presentation times. It also records snapshot sizes
and memory stages as source, documents, and snapshots are retained and released.

Timing includes native extraction, copying, and strict JavaScript decoding. It
excludes rendering, validation, garbage collection, and disposal. Post-GC process
memory counters describe retained memory. Wasm capacity includes allocator free
space and remains a high-water capacity. Serialized JSON size measures output
bytes. These values establish a baseline; they do not establish a speedup.

The [complete baseline report](measurements/presentation-0.1.10.json) records all
eight cases with five measured samples and one warmup per case. It ran under
Node 26.7 on an M1 Mac with AC power and an exclusive agent reservation. The report
retains background load observations and artifact hashes. The execution host's
temporary workspace, runtime, source archive, and reservation were removed and
cleanup was verified. The earlier one-case `baseline-smoke.json` validated the
method before this run.
