# Release 0.1.19

With `gfm: true` and `cjk: true`, literal links trim CJK boundary punctuation
before trimming trailing ASCII punctuation and validating the domain. This
rejects `https://dotless.。`, `https://foo_bar.test.。`, and `www.。`.
Valid dotted links keep their source ranges through exact, open, and ended
output. Explicit Markdown links, angle links, and the CJK-off profile retain
their existing behavior.

The semantic text fallback and decoration text fallback now pass the CJK option
to the same matcher. The semantic writer no longer shortens an already validated
candidate independently.

## Source inventory

| Classification | Local files | Source and revision | Change |
| --- | --- | --- | --- |
| Adapted upstream implementation | `src/autolink.c` | github/cmark-gfm `extensions/autolink.c`, `499789b49373bfa045d0e7547e5ee63444c77bca`, BSD-2-Clause | Trim the configured CJK boundary before ASCII trailing punctuation and domain validation. |
| Original integration | `src/autolink.h`, `src/resolver.h`, `src/leaf.c`, `src/semantic.c` | Original tree-sitter-md code | Carry the CJK option through both text fallbacks and remove the second semantic cut. |
| Original regression tests | `tests/autolink-cjk-terminal-dot.test.ts`, `tests/autolink-cjk.c`, `tests/native.c`, `scripts/check-native.sh` | Original tests derived from the disclosed r77 counterexamples | Cover matcher and mapped fallback endpoints, public UTF-16 ranges, all CJK punctuation boundaries, exact/open/ended output, incremental edit/undo, and explicit/angle/CJK-off controls. |

## Evidence and limits

Before the fix, the focused public regression file failed 31 tests and passed
9 controls. The direct native matcher aborted on the first dotless-host case.
Only the resolver Wasm is rebuilt. Both grammar sources and grammar Wasm files
are unchanged. No full fuzz, qualification, or heldout replay is part of this
bounded fix. The PR records the completed checks.
