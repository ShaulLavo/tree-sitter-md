# Native Markdown streaming for AI chat

Status: **Approved**, requested 2026-10-16. P0 and P1 are implemented; P2 through P5 have not started.

P1 delivery, 2026-10-18: the native document retains original UTF-16 separately
from normalized parser text. `presentation({ input })` returns owned source,
mode, revision, profile, exact root, and presentation metadata through a native
entry point and strict decoder. Recursive pending types are defined. P1 keeps
both modes exact with empty metadata; the full P0 presentation matrix remains
unqualified until native interpretation and reference reporting are implemented.

P0 delivery, 2026-10-17: 33 original fixtures contain 76 independently authored
open and ended checkpoints. The driver compares nested trees, ranges, interpretation
metadata, and reference outcomes, and runs exact fresh/incremental comparisons.
The Textual three-append replay and comparator corruption controls are included.
Native presentation is still missing and produces a nonzero qualification result.
See the [fixture contract and commands](../tests/streaming/README.md).

Deliver an AI chat presentation API in tree-sitter-md that interprets unfinished
Markdown in native code, preserves received source, and permits earlier content to
change meaning. Correctness precedes optimization. Fregat adoption and frame-by-frame
renderer verification follow in a separate work package.

This expands M3 of the [semantic producer plan](bubli-semantic-markdown.md). It does
not reopen the semantic API delivered in [PR 13](https://github.com/ShaulLavo/tree-sitter-md/pull/13)
or claim that the producer plan's other M0–M4 requirements are all complete.

## Baseline and ownership

Inspected source: `e75501daeac8cf7075a7cdc0810b0f89c504f650`, package 0.1.5.
Refresh source, runtime pins, instructions, and active work before implementation.
Coordinate with concurrent runtime-memory work; this plan requires no particular
unmerged fix and introduces no tree-sitter-x rewrite.

- `MarkdownDocument` already owns source edits and revisions. `semantics()` returns
  complete, owned trees with decoded text, links, lists, tables, math, footnotes,
  capabilities, and UTF-16 source ranges. Keep this exact interpretation available.
- `src/document.c` owns native source, incremental trees, and invalidation.
  `src/semantic.c` builds semantic results; `src/leaf.c` maps container content.
  `vendor/cmark/inlines.c` holds delimiter and bracket state before cleanup.
- `js/index.js` owns the handle and copy/decode/release boundary. JavaScript validates
  requests and native output; Markdown interpretation belongs in C.
- The host owns transport errors, HTML isolation, URL activation, image fetching,
  rendering, selection, scrolling, and virtualization. A parsed URL is not a security
  approval. The core reports pending constructs without an actionable destination.

Full owned snapshots are acceptable initially. Durable node IDs, semantic deltas,
dependency indexes, partial extraction, and caches are subsequent measured work.
There is no promise that every block preceding the final block is immutable.

## Behavior references and chosen direction

The October 16 ecosystem study inspected thirteen pinned projects. These references
are sufficient to reproduce the decisions below from a fresh clone; local research
archives and reference checkouts are not prerequisites for implementation or CI.

| Reference | Borrow | Avoid inheriting |
| --- | --- | --- |
| [Streamdown/remend `4c55fad1`](https://github.com/vercel/streamdown/tree/4c55fad1bb739fba788b1f55bbe878983243edf0/packages/remend) | Readable unfinished formatting; nested-container and code-preservation properties | Repaired source strings, placeholder destinations, and the observed nested-delimiter failure |
| [Codex `6ae8b8aa`](https://github.com/openai/codex/tree/6ae8b8aa7c608730d4315d59c5c081897ae02780/codex-rs/tui/src/streaming) | Disposable previews, mutable earlier content, explicit reference reflow, canonical terminal consolidation | Newline buffering, injected final newline, and terminal layout policy |
| [SwiftStreamingMarkdown `95bb755a`](https://github.com/microsoft/SwiftStreamingMarkdown/blob/95bb755a9b23a1aea8682b9ebc912cb72b176c95/Tests/MarkdownTextTests/PartialMarkdownRewriterTests.swift) | Partial-delimiter examples and speculation over semantic structure | Hiding ordinary table-candidate text; assuming the default stream view enables speculation |
| [codewandler/markdown `ad16fe51`](https://github.com/codewandler/markdown/tree/ad16fe51f9a98e65037af14f2bcd36c62b252d80/crates/markdown-stream/tests) | Split-equivalence tests and explicit unresolved references | Irreversible emission that blocks later prose behind an unresolved reference |
| [Textual `5e5b7ef5`](https://github.com/Textualize/textual/blob/5e5b7ef58b8c5572c13a3ff9027d756623661495/src/textual/widgets/_markdown.py) | Reclassification and retained-content test cases | Chunk-dependent final reference resolution and stale blocks |

Streamdown and Codex disagree at termination. Streamdown's healing is gated by
streaming mode and `parseIncompleteMarkdown`, independently of `isAnimating`.
Codex consolidates to canonical full-source Markdown. This plan selects **canonical
ended output**, while permitting optimistic live presentation. An unmatched marker
can therefore become literal at termination. This is an explicit semantic transition;
renderer work must later distinguish it from unnecessary remounting or blank frames.

Keep primary-source attribution and licenses with any imported fixtures or code.
Prefer original regression inputs with independently authored expectations. Other
projects' advertised streaming or conformance claims do not establish our correctness.

## Caller contract and native design

Planned usage, with the final declarations settled in P1:

```js
const document = new MarkdownDocument({ gfm: true, cjk: true, math: true })
document.setText(source)
const exact = document.semantics()
const live = document.presentation({ input: 'open' })

document.edit(source.length, source.length, delta)
const next = document.presentation({ input: 'open' })
const ended = document.presentation({ input: 'ended' })
document.dispose()
```

`presentation` is a read of the existing document, not another parser or stream
session. It does not append delimiters, change received source, or seal the document.
Pause and retryable delivery failure keep input open. Success, cancellation, and
permanent failure request ended input. Resume applies ordinary source edits and
requests open input again. The application retains the transport reason.

An ended presentation agrees with `semantics()` after removing presentation-only
metadata. An unclosed fence can still be a valid exact code block at EOF. Transport
completion and syntactic closure are separate facts.

The result carries source revision, requested input state, profile, capabilities,
original source, and a recursively typed presentation tree. Open presentation nodes
distinguish received interpretation from provisional interpretation, with a reason
and original source range. Pending link and image variants have no `url` field;
completed links retain a required destination. Do not cast the provisional tree to
the exact semantic type or use nullable links as a substitute for distinct variants.

Source revision alone is not the result key: open and ended reads of unchanged source
can differ. Different documents remain independent. Returned snapshots own their
buffers and remain valid across edits, source replacement, memory growth, and disposal.
Revisions are document-scoped; hosts also retain the document owner. Reparsing and
presentation queries do not advance source revision. Use a defined normalization
that removes only presentation metadata when comparing ended and exact trees.
Source ranges are UTF-16 units, not bytes, grapheme positions, or renderer coordinates.
Ranges describe authored constructs; decoded text need not map character-for-character.

Track provisional interpretation separately from block structural completion and
reference dependencies. A closed paragraph can contain an unresolved reference.
Definitions and footnotes may update earlier uses. Full native traversal may initially
resolve these dependencies on every read. Expose their status without promising a
minimal change set or treating source offsets and sibling indexes as durable IDs.

Use native EOF awareness while building the semantic result. Preserve eligible
unmatched delimiter and bracket information before emphasis processing destroys
opener ownership, not merely before the final stack-free loop.
Apply temporary EOF only to source-mapped content that actually reaches document EOF,
including a final leaf inside nested containers. Exact parsing and earlier closed
leaves keep their ordinary rules. Share the grammar, resolver, flanking logic, and
source mapping. Do not reconstruct syntax with a second regex parser or heal a source
string before reparsing it.

## Initial AI chat behavior

Every row needs exact prefix trees, source correspondence, and terminal expectations
before its implementation lands. These defaults define this plan's initial profile.
Changes to them must update the named fixtures and explain the observed tradeoff.

| Received prefix | Open presentation | Ended presentation |
| --- | --- | --- |
| Ordinary text without a newline | Show all received ordinary text immediately | Exact semantics |
| `**outside *inside` | Provisional strong containing emphasis, using eligible native opener ownership | Exact unmatched-marker interpretation |
| An escaped or non-flanking emphasis marker | Preserve ordinary literal interpretation | Exact semantics |
| An unclosed code span with content | Provisional code from the received content; use native code-span rules | Exact literal fallback if no closing run exists |
| A bare backtick or emphasis run without content | Keep ambiguous marker-only syntax out of the live presentation; record its source span | Exact literal or block interpretation |
| An open fence, including nested quote/list fences | Existing code-block interpretation; display received content without invented newlines or closers | Exact EOF-fence semantics |
| `[label](https://exa` or `[par` | Readable pending label with no destination | Exact literal fallback where the link is unfinished |
| `![alt](https://exa` | Pending image exposing received alt content, with no fetchable destination | Exact literal fallback where the image is unfinished |
| A pipe row or incomplete table separator | Keep received text visible as a paragraph until valid GFM table syntax exists | Exact GFM interpretation |
| Bare heading, quote, list, or task markers | Suppress empty trailing presentation only; preserve the received marker spans | Exact interpretation |
| Paragraph followed by a valid setext underline | Reclassify as a heading | Exact heading interpretation |
| Incomplete HTML | Keep unfinished content readable as literal data; never invent closing tags | Exact HTML interpretation, with host isolation unchanged |
| Unfinished double-dollar math with content | Pending math containing received TeX; avoid reinterpreting its contents as emphasis | Exact existing math interpretation |
| Single-dollar currency | Existing literal interpretation | Same configured dialect |
| Late or duplicate reference/footnote definitions | Resolve all affected earlier uses; keep later ordinary prose visible | Exact existing precedence and numbering |

Complete emphasis, links, code, tables, math, CJK delimiters, escapes, and entities
retain the configured dialect. Table candidates can reclassify; list tightness can
change. Do not preserve an incorrect interpretation to maintain UI identity.
Source copy always uses received source. Readable copy may use the selected view;
the host must select that behavior explicitly when it integrates the API.

## Implementation units

### P0. Freeze independent expectations

- [x] Record parser and runtime revisions, toolchains, options, and corpus provenance.
  Reconcile actual delivered semantics with the older producer-plan inventory.
- [x] Add original fixtures under `tests/streaming/`, with IDs, received source,
  configured dialect, selected input state, expected nested interpretation, provisional
  reasons, ranges, and reference outcomes. Include every behavior row above.
- [x] Include the nested-remend case and Textual's exact input
  `[late][id]\n\nTail\n\n[id]: https://example.com\n` under batch, three-append, and
  one-code-unit schedules. Record actual nested nodes, not flattened visible text.
- [x] Build one reusable fixture driver for fresh and edited documents. A missing
  presentation implementation produces an explicit missing-capability result, never
  a ready verdict. Native features land with their failing expectations made passing.
- [x] Add `tests/streaming.mjs` as a top-level Node test entry for fixture-schema
  and negative-control checks. Add feature assertions alongside their native
  implementations; the full qualification driver must still report every required
  unimplemented fixture as missing until all families are delivered.
- [x] Prove the driver rejects wrong nesting, stale references, missing text, and
  range corruption through negative controls. Expected failures do not certify a row.

Exit: reviewed executable expectations and a driver that detects deliberately wrong
outputs. No blanket fixture regeneration from our parser, remend, or remark output.

### P1. Establish source and result ownership

- [x] Settle the small presentation request/result declarations in `js/index.d.ts`
  and shared semantic types. Include independent input state and source revision.
- [x] Audit raw-source ownership in `src/document.c`. The baseline normalizes NUL
  to U+FFFD in its parser buffer. That is legitimate Markdown normalization, but the
  new source field must preserve the original supplied UTF-16 sequence independently.
  Choose raw retention or normalization at a parser-input boundary; test NUL,
  literal U+FFFD, BOM, CRLF, and split surrogate pairs separately.
- [x] Carry the request through `src/resolver.h`, `scripts/build.sh`, `src/semantic.c`,
  and `js/index.js`. Extend the strict native-result decoder in `js/semantic.js`.
  Keep new interpretation logic out of JavaScript.
- [x] Preserve exact `semantics()`, decorations, highlights, folds, and injections.
  Add invalid-request, disposal, owned-result, and same-revision/different-mode checks.

Exit: exact output and source fidelity pass, with native/binding ownership and
presentation variants tested. Do not advertise the full streaming profile yet.

### P2. Interpret unfinished inline syntax natively

- [ ] Observe delimiter/bracket state before cleanup in `vendor/cmark/inlines.c`.
  Keep the exact entry point's behavior intact. Document any intentional local change
  to the vendored inline resolver; avoid a second delimiter scanner.
- [ ] First prove nested opener ownership, pending brackets, and source mapping in
  a bounded native fixture. If emphasis cleanup has already lost the needed state,
  move observation earlier in native resolution before broad implementation.
- [ ] Pass temporary EOF from `src/semantic.c` to eligible leaves; reuse `src/leaf.c`
  continuation mapping and configured CJK/flanking rules.
  Test trailing spaces, a single newline, and trailing nested-container prefixes.
  Determine EOF from original source mapping, not trimmed inline-buffer length.
- [ ] Implement nested provisional emphasis, code spans, pending links/images,
  escaped delimiters, and pending math with each family's independent prefix fixtures.
  Define `pendingMath` explicitly in recursive presentation types and the decoder;
  its TeX is received data, never a synthesized valid math expression.
- [ ] Keep all destinations absent until the link/image syntax is complete. Preserve
  code content and existing normalization rules without synthetic source characters.

Exit: inline families agree with their specified prefixes and ended exact semantics.
Interleaving open and exact reads cannot contaminate either result or another document.

### P3. Handle block reclassification and document dependencies

- [ ] Cover fences with arbitrary matching runs, language/info fragments, nested
  containers, headings, list/task markers, tightness, table candidates, wide tables,
  and HTML. Ordinary prose has no newline or unrelated-reference visibility barrier.
- [ ] Resolve definitions and footnotes across the entire document. Exercise late,
  duplicate, deleted, and changed definitions before and after their uses.
- [ ] Verify replacement of a paragraph by a table/heading and removal of stale
  definition text. Separate required semantic changes from correspondence metadata.
- [ ] Compare fresh and edited results after insertions, deletions, undo-shaped edits,
  and whole-source replacement. Validate source ranges throughout nested containers.

Exit: complete snapshots have correct earlier uses, no stale blocks, no lost columns
or code whitespace, and no append-only correctness concessions.

### P4. Prove chunk, lifecycle, and lifetime correctness

- [ ] Run every UTF-16 prefix and every two-chunk split for at least 32 short fixtures
  spanning the behavior families. Use eight fixed-seed multichunk schedules for every
  selected development message and bounded schedules for larger corpus documents.
- [ ] Compare identical source, options, and input state through fresh loading and
  every incremental schedule. Compare full nested values, per-node ranges,
  provisional states, and resolved destinations, not only total text or event counts.
- [ ] Cross representative prefixes with repeated open/ended queries, pause,
  cancellation, failed delivery, resume, source replacement, and multiple documents.
  Metadata-only transitions must work when source revision is unchanged.
- [ ] Assert ended output agrees with exact semantics, and raw-source reads always
  preserve supplied source. Keep exact official CommonMark/GFM expectations and
  existing explicit profile differences independent of presentation expectations.
- [ ] Exercise allocation failure paths already supported, memory growth, repeated
  disposal, retained snapshots, deep nesting, and many documents under native
  ASan/UBSan and real WASM tests. No stale native views or cross-document state.

Exit: no unexplained differences, missing required cases, silent skips, or source
loss in the selected profile. UTF-8 decoder splits are outside this string API;
only a future byte API would own byte-decoder behavior.

### P5. Package and record a correct baseline

- [ ] Require all presentation fixtures in `tests/streaming.mjs` and existing CI.
  Reuse the fixture driver for a small report command recording pins, case counts,
  failures, and capability gaps. A missing capability must make qualification fail.
- [ ] Extend native tests and packed Node, Bun, and production Vite/Chromium consumers
  to exercise exact and presentation APIs, EOF transitions, source replacement,
  independent documents, source fidelity, memory growth, and retained results.
- [ ] Run existing release gates without weakening them. Publish the next patch
  version with types, generated grammar/resolver artifacts, notices, and API examples.
- [ ] Record complete-document parse/extraction time and retained memory for bounded
  representative and pathological workloads. Measurements characterize this correct
  baseline; they are not a speedup claim or an optimization competition.

Exit: merged implementation, passing package checks, and an exact tested artifact.
Record any publishing delay separately from code/package readiness. This completes
the native streaming work, not Fregat chat qualification.

## Verification and delivery

Use the documented compiler, WASI SDK, native tree-sitter source, and browser
prerequisites. These existing commands run from the repository root:

```sh
bun install --frozen-lockfile
(cd bench && bun install --frozen-lockfile)
bun run build
npm test
bun run check
bun run test:native
bun run test:package
```

`WASI_SDK` and `TREE_SITTER_LIB` follow README setup. `node --test tests/streaming.mjs`
is the planned focused entry point, available after P0 adds it. Package/browser
prerequisites and host scheduling remain execution-environment concerns; committed
tests must not require local reference clones, private routes, account access, or
machine-specific absolute paths. Keep builds, probes, and teardown portable.

At each implementation unit, run the narrow relevant checks; run all release gates
before publishing. Record executed denominators and failures, including controls.
Review, merge, and verify post-merge checks. Install teardown before temporary
consumers, servers, or environments; preserve small reports and remove owned scratch
resources. The planning change itself requires documentation/link checks, not a
parser build or a package-version change.

Fregat adoption subsequently consumes the released contract through its existing
qualification plan. That work must reassess the JavaScript rendering boundary and
verify actual frame sequences, highlighting, selection/copy, scroll anchoring,
virtualization, reload, and termination behavior. Parser tests alone cannot establish
flicker-free presentation. Its remark implementation supplies comparisons and known
failures, not the universal streaming oracle.

## Design decision

Use the existing document with a separate exact/presentation API boundary. Recover
provisional structure during native resolution while parser state is available.
This combines the small interface of the presentation-snapshot design with native
EOF-aware extraction. It adds no second syntax parser or post-hoc string-repair pass.

Rejected alternatives are source healing with placeholder destinations, irreversible
event-only output, a duplicate stream-session lifecycle, and a promise of a permanently
settled prefix. Full snapshots and possible terminal reinterpretation are accepted
tradeoffs. Optimization follows the measured correct baseline; API changes should
follow evidence rather than an assumed rendering bottleneck.
