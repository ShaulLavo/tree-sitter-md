# perf-next

Benchmark and stress probes for comparing parser builds. Each script takes the path of a tree-sitter-md checkout (`stress.mjs` takes two, a baseline and a candidate) and imports `js/index.js` from it. They are not part of the package or CI.

| Script | Measures |
| --- | --- |
| `bench-targets.mjs` | Targeted workloads: reference definitions, tables, continuations, large paragraphs, mixed scripts. |
| `bench-encodings.mjs` | Edits in ASCII, Hebrew, Chinese and emoji paragraphs. |
| `keystroke-isolated.mjs`, `warm-keystroke.mjs` | Keystroke cost on `agents.md` and `big.md`, cold and warmed. |
| `stress.mjs` | Edit and undo sequences compared between a baseline and a candidate. |
| `public-checks.mjs` | Runs the repository's public checks and writes their output to a directory. |
