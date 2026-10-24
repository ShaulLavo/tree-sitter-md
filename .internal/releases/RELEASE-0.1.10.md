# Release 0.1.10

Fixed exact and presentation extraction for nested containers near the supported
container limit. Footnote collection and semantic extraction now keep traversal
scratch within the native and Wasm execution limits. The public API is unchanged.

Added exhaustive streaming qualification and ordinary lifecycle checks for packed
Node, Bun, and production Vite/Chromium consumers. The checks cover mode transitions
without source revision changes, source replacement, independent documents, raw
UTF-16 source, memory growth, and snapshots retained after edits and disposal.
CI also retains the exhaustive qualification report.

Local parser and lifecycle proof passed 4,180 exact and 8,360 presentation
comparisons. The independent authored oracle passed another 1,147 exact and 364
presentation checks. All 21 focused tests passed, and the recorded native
ASan/UBSan and cursor checks passed. All nine packed Node, Bun, and Vite/Chromium
initialization combinations passed, along with the dedicated Chromium 153
resizable-memory suite. See the
[qualification commands, counts, and evidence](../streaming-qualification.md).

The supported native reserve allocation-abort contract also passed in an owned
child. The public build does not expose an allocator injection hook for the
default cmark/tree-sitter allocators.

The local release gates passed all 1,791 Node tests, public type checks, 676
official spec cases, 183 chat fixtures, and the 497-document pinned repository
corpus. All 11,300 fuzz edits passed, and the 10 negative controls failed as
expected. The [complete-document baseline](../measurements/presentation-0.1.10.json)
records all eight bounded workloads with five measured samples and one warmup per
case. It records timing, retained memory, load observations, and artifact hashes.
CI still awaits execution.

Publication is delayed separately by npm authentication failure `E401`.
Version 0.1.10 has not been published. Fregat adoption and renderer
qualification remain separate work.
