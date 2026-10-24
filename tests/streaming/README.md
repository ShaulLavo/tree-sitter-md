# Streaming fixture contract

The fixture corpus is an independently authored behavior oracle. It does not import
the parser, remark, remend, or generated parser output. Tests may compare a real
parser result with these expectations, but must not regenerate them from that result.

Each fixture has an ID, required behavior IDs, source, parser options, attribution,
and named checkpoints. A checkpoint identifies a UTF-16 source offset, input state
(`open` or `ended`), and an expected observation. Checkpoint sources are prefixes of
the fixture source. The fixture's final source has both open and ended checkpoints.

An observation contains:

- `root`: the complete recursively nested semantic tree, with literal expected
  values, relevant attributes, and original UTF-16 ranges on every authored node.
- `provisional`: records `{ path, reason }` referring to nodes in `root`. A path is
  an array of property names and array indexes, relative to the root. For example,
  `['children', 0, 'children', 0]` identifies the first inline in the first block.
- `suppressed`: records `{ range: { start, end }, reason }` for received syntax
  deliberately withheld from the live view.
- `references`: records `{ kind, identifier, range, resolution }` for selected
  link/footnote uses. This list includes both unresolved and resolved uses in fixtures
  whose purpose is reference invalidation.

The driver adapter converts public presentation results to this test-only
observation. It may translate declared metadata; it must not parse or heal Markdown,
invent missing semantic structure, or use the expected observation as a fallback.
Exact-parser comparisons use the independent ended root and separately compare
fresh versus incremental results.

The suite runs these chunk schedules: whole input, codepoint appends, UTF-16-unit appends,
and one named midpoint two-chunk split. The Textual regression also has an explicit
three-append schedule. Exhaustive two-chunk splits and the broader lifecycle matrix are not
covered.
Checkpoints are actively evaluated whenever their source prefix is visited, and are
also loaded independently so a chunk schedule cannot accidentally skip an oracle.

A missing native presentation capability is a recorded result for every required
checkpoint, never a passing comparison. A candidate method's presence alone cannot
make qualification ready. Deliberately corrupted observations must fail through the
same comparator used for actual candidates.

The corpus has 33 fixtures, 76 checkpoints, and 15 behavior rows. `fixtures.mjs` contains original authored expectations and source provenance.
Its small constructors only build literal semantic nodes and ranges; they do not
call a parser. Exact ended roots run against the real native parser. The Node
suite requires every declared presentation checkpoint to pass. Native inline
presentation, empty trailing block suppression, and reference metadata are covered.
`tests/presentation-inline.mjs` adds authored EOF, ownership, and payload cases.
`tests/presentation-blocks.mjs` and `tests/presentation-dependencies.mjs` extend the
matrix with block reclassification, arbitrary fences, wide tables, changed and
deleted definitions, latent reference dependencies, and mapped source ranges.

After the root dependencies are installed, run:

```sh
node --test tests/streaming-driver.mjs tests/streaming.mjs
bun run streaming:check
```

The first command checks the corpus, exact parser, and corruption controls. The
second prints a JSON report and exits `2` while presentation is missing, `1` for a
comparison failure, or `0` when the declared matrix passes. A pass does not cover
exhaustive chunk splits or the full lifecycle matrix.

Reports include every comparison's result and denominator, a fixture-content hash,
the recorded source baseline, actual runtime and package versions, runtime pin,
WASM hashes, and Node/platform identity. They contain no machine-specific source
paths. The driver exercises the public API and reports each presentation difference.

The one explicit observer override exists to test the driver at its adapter boundary.
Normal qualification calls `MarkdownDocument.presentation({ input })` directly; the
observer must expose this test-only observation schema. If the eventual native
metadata representation differs, translate it at that boundary. No adapter may
derive missing structure from the expected fixture or invoke another Markdown parser.
