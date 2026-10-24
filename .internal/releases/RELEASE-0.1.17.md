# Release 0.1.17

GFM literal HTTP(S) links now require a dotted domain. Domain validation advances
by UTF-8 scalar width, so an underscore after Unicode cannot escape the rule
against underscores in the final two domain labels. Validation runs after URL
trailing punctuation is removed; dots in a port suffix, path, query or fragment
cannot validate a dotless host.

This implements the domain rules in [GFM 6.9](https://github.github.com/gfm/#autolinks-extension-).
It does not apply those rules to CommonMark angle autolinks or explicit Markdown
links. Valid earlier-label underscores, ports, paths and trailing punctuation
retain their existing behavior. The existing cmark-gfm security exception for
underscore rejection beyond ten domain dots remains unchanged; this patch does
not claim complete domain conformance for that exceptional case.

## Source inventory

| Classification | Local files | Source and revision | Local change and reason |
| --- | --- | --- | --- |
| Adapted upstream implementation | `src/autolink.c` | github/cmark-gfm `extensions/autolink.c`, `499789b49373bfa045d0e7547e5ee63444c77bca`, BSD-2-Clause | Remove the HTTP(S) short-domain allowance, traverse complete UTF-8 scalars including the first and last characters, and validate the punctuation-trimmed candidate. Keep upstream host-character categories and its long-domain security exception. |
| Original regression tests | `tests/autolink-domains.test.ts`, `tests/native.c`, `tests/resolver.mjs`, `tests/autolink-interior.mjs`, `tests/streaming/fixtures.mjs` | Original tree-sitter-md tests; saved r68 development observations as behavioral evidence only | Preserve exact UTF-16 source identities for the disclosed witnesses, add spec-derived invalid and valid controls, replace old dotless-host expectations, including two incomplete-destination ended roots, and keep emphasis-interior fixtures valid under the domain rule. No reference parser implementation is copied. |

## Evidence and limits

The source rebuild at `632dbf3dd12766f1407546fe08e4272a3ad7ca46` reproduced
its checked-in Wasm bytes. The new regression file initially failed twelve tests,
including the exact saved observations `181/completed/39` and `196/completed/63`.
Their original UTF-16LE hashes are asserted before native parsing. No UTF-8
round-trip or surrogate replacement is used to construct those inputs.

The checks target native link recognition and decoration/semantic agreement.
They do not certify Fregat repair policy, whole saved-row equivalence, the other
mismatch families, or full development qualification. Package integration and
independent review remain separate work.

The final JavaScript suite passed 2,054 tests, including all four disclosed source
clusters and an incremental Unicode/underscore edit-and-undo control. Native
ASan/UBSan, the spec/repository/chat gates, public presentation types, resizable
Wasm-memory browser checks, and packed Node/Bun/Vite browser consumers passed.
A bounded direct-native replay found no links in the 43 exact F02/F03 sources in
exact/open/ended modes. This checks native URL fields only: those saved paired
rows retain their red qualification status pending separate adapter qualification.

ASCII final-label underscore controls were already correctly rejected before
this patch. The failing controls isolate dotless hosts, Unicode traversal and a
leading underscore in the final label; they do not label every underscore case
as a new defect. No performance claim or full development sweep is made.
