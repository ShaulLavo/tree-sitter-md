# Shared semantic Markdown for bubli and editor consumers

Status: proposed implementation plan, requested by the owner on 2026-09-28. This PR contains documentation only. No parser, runtime, dependency, release or consumer changes are implemented by merging it.

## Outcome and ownership

Use `tree-sitter-md` on the owned `tree-sitter-x` runtime as the Markdown engine for bubli. Replace Marked in bubli after the semantic, rendering, packaging and consumer gates pass. Supply one renderer-neutral contract to terminal and browser consumers while retaining the compact editor-oriented APIs.

This repository owns Markdown grammar/resolution, semantic results, source mapping, incremental invalidation, differential fixtures and the packaged grammar/resolver artifacts. It does not own React, terminal cells, DOM layout, themes, backend state or Fregat's document service.

## Connected work

All companion plans use the `docs/bubli-plans-2026-09-28` branch while under review. The coordination page records the actual PRs; use its main-branch version after the planning set merges.

- [Cross-repository coordination and research](https://github.com/ShaulLavo/bubli/blob/docs/bubli-plans-2026-09-28/docs/bubli/README.md).
- [bubli renderer, React components and experience](https://github.com/ShaulLavo/bubli/blob/docs/bubli-plans-2026-09-28/plans/bubli-experience.md).
- [Singapore consumer integration](https://github.com/ShaulLavo/singapore/blob/docs/bubli-plans-2026-09-28/plans/bubli-markdown-consumer.md).
- [Fregat adoption and cross-project ordering](https://github.com/ShaulLavo/fregat/blob/docs/bubli-plans-2026-09-28/plans/201-bubli-tui.md).
- Existing Fregat [176](https://github.com/ShaulLavo/fregat/blob/4f587e90091cb0a74b314276a038b45685da572b/plans/176-markdown-parser.md) owns the original parser/editor integration; [189](https://github.com/ShaulLavo/fregat/blob/4f587e90091cb0a74b314276a038b45685da572b/plans/189-tree-sitter-md-improvement.md) owns subsequent correctness, required extensions and measured optimization. This is the renderer-facing work package, not a competing owner for those plans.

## Current evidence and drift

Baseline: `5dd917ae70eea5f6a38a2ba8825ce6d3baca697d`. Re-read current source and release evidence before implementation.

- [README](https://github.com/ShaulLavo/tree-sitter-md/blob/5dd917ae70eea5f6a38a2ba8825ce6d3baca697d/README.md) and [release record](https://github.com/ShaulLavo/tree-sitter-md/blob/5dd917ae70eea5f6a38a2ba8825ce6d3baca697d/docs/RELEASE-0.1.md) report 676/676 CommonMark/GFM examples, 183 chat fixtures and the pinned 497-document corpus. Packaging checks already cover Node, Bun, Vite/Chromium, initialization order and sibling document isolation. Do not schedule the earlier 674/676 failures or basic runtime extension loading as unimplemented work.
- [Public types](https://github.com/ShaulLavo/tree-sitter-md/blob/5dd917ae70eea5f6a38a2ba8825ce6d3baca697d/js/index.d.ts) expose edits, decorations, highlights, folds and injections. A complete renderer-facing semantic snapshot is not part of that inspected API.
- The original [spec runner](https://github.com/ShaulLavo/tree-sitter-md/blob/55ce090f6ac195bceb314d7cb29760295ce8df2d/bench/spec.mjs) and [normalizer](https://github.com/ShaulLavo/tree-sitter-md/blob/55ce090f6ac195bceb314d7cb29760295ce8df2d/bench/constructs.mjs) compare selected construct ranges/metadata against micromark; list tightness is excluded by default and resolved URLs/titles are not compared. Re-audit the current runner before making a stronger compatibility claim. A construct score is not rendered-output certification.
- The record model's `Definition` means link-reference definition, not a term/description definition list. Its packed table alignment representation must not impose the older first-12-column limit on the new semantic API.
- Source inspection and repository-reported checks are the evidence available for this plan. No tests were run as part of writing it.

## Compatibility profiles

1. **CommonMark 0.31.2:** nested blocks/inlines, ATX/setext headings, thematic breaks, fenced/indented code, escapes/entities, normalized code spans, HTML constructs, links/images and references, ordered starts, tight/loose lists, hard/soft breaks and Unicode behavior. [Specification](https://spec.commonmark.org/0.31.2/).
2. **GFM:** tables, task lists, strikethrough and autolink literals. Compare both the full [GFM specification](https://github.github.com/gfm/) and the selected [Goldmark v1.7.17 extension](https://github.com/yuin/goldmark/blob/v1.7.17/extension/gfm.go). Record version/behavior disagreements explicitly; do not silently redefine the common profile to match one implementation.
3. **Crush/Glamour:** [Glamour v2.0.1](https://github.com/charmbracelet/glamour/blob/v2.0.1/glamour.go) enables definition lists and automatic heading IDs in addition to GFM. Expose definition-list structure. Decide and document heading-ID normalization/collision handling for browser consumers. [Crush's renderer](https://github.com/charmbracelet/crush/blob/06e50a330e2b05b677726737d06852a35f5ff93f/internal/ui/common/markdown.go) distinguishes standard, user, quiet and plan presentation. The semantic data must preserve line-break provenance so renderers can implement those profiles.
4. **Existing required extensions:** footnotes, math, CJK-friendly flanking, wiki links, callouts/GitHub alerts and highlights remain required by Plan 189. Each has explicit options and its own suite. They are not all prerequisites for the initial Crush profile and are not cancelled or made optional by this plan. Ship them through their existing owner and make the semantic contract extensible enough to carry them.
5. **Host policy:** parsing HTML, links, image references or custom constructs never authorizes script execution, file reads, network fetching, terminal control sequences or MDX evaluation. Hosts define safe display and activation policy separately from syntax recognition.

## Semantic result contract

Keep the compact record path. Add renderer-oriented access only where consumers need it; final exported names and binary representation are implementation decisions after a measured prototype.

- A result identifies document incarnation, source revision, parse profile/options, coverage and semantic schema version. An older response cannot update a replaced or disposed document.
- Blocks and inlines retain nesting, original UTF-16 source spans and decoded display text. Raw text remains available for copy/export; terminal cell widths are renderer-owned and never substituted for source offsets.
- Links/images expose resolved destination, title, display/alt content and reference provenance. Preserve first-definition-wins rules, entity decoding and nonlocal reference invalidation.
- Lists expose ordered start, delimiter where meaningful, tight/loose metadata, task state and nested item boundaries. Definition lists expose terms and descriptions explicitly.
- Tables expose rows, cells and alignment for every supported column. Handle escaped pipes, empty cells, short/long rows and pathological widths without silent truncation of metadata.
- Code exposes normalized content, language/info metadata and exact injection/source ranges. Fenced languages continue to use the existing language registry rather than embedding every grammar here.
- Changes identify affected semantic blocks, including earlier references affected by a later definition. Use stable document-local identity or a documented correspondence operation; source offsets and sibling indexes alone are not stable React keys.
- Specify lazy-range completeness: requested viewport coverage may omit other blocks, but dependency resolution must not accidentally treat unseen references as absent. Partial, complete, pending and failed results are distinguishable.
- Returned buffers have explicit ownership and lifetime. Callers cannot retain invalid WASM memory views across growth, edits or disposal. Preserve independent documents and idempotent disposal.

## Implementation units

### M0. Reconcile and freeze the executable baseline

- [ ] Record parser, native-runtime source and built `web-tree-sitter` artifact revisions separately.
- [ ] Run the existing release gates unchanged and record full-source versus viewport measurements honestly.
- [ ] Audit semantic information already retained in `src/document.c`, `src/leaf.c`, the inline resolver and `js/`; expose it instead of reparsing in JavaScript.
- [ ] Add a field-by-field semantic fixture schema and reference manifest, with licenses and exact oracle versions.

Exit: current baseline and ownership map recorded; completed release work is not reopened without a reproduction.

### M1. Expose semantic structure and source correspondence

- [ ] Implement the contract above with focused cases for decoded text, URLs/titles, list starts/tightness, definition lists, tables beyond 12 columns and reference provenance.
- [ ] Preserve existing decorations/highlights/folds/injections and simple `MarkdownDocument` usage. Any necessary public break is paired with all affected consumers and a release note, not a permanent alias.
- [ ] Add result revision/coverage and nonlocal invalidation tests; reject stale or disposed results.
- [ ] Measure full-snapshot and bounded-range cost before selecting a representation. Avoid whole-document materialization per appended token.

Exit: bubli and Singapore can consume one semantic fixture without reconstructing Markdown using regex or Marked-compatible tokens.

### M2. Prove semantic compatibility

- [ ] Extend conformance beyond construct counts: compare normalized semantic trees and/or a test-only canonical HTML renderer against official expected examples.
- [ ] Compare to pinned Goldmark/Glamour for enabled extensions and preserve explicit intentional-difference fixtures. Include output text, URLs, alt/title values, nesting, numbering, spacing-relevant metadata and table alignment.
- [ ] Preserve existing corpus and negative controls; every new mismatch gets a minimal fixture before its fix.
- [ ] Give parsing correctness and safe host rendering separate reports. A host sanitization choice is not a grammar failure; a missing URL is not a styling difference.

Exit: zero unexplained semantic mismatches in the selected profile. Document deliberate bounds and divergences; do not use a percentage to hide them.

### M3. Streaming, edits and resource lifetime

- [ ] Test every single split point on representative inputs plus seeded multi-chunk streams, including CRLF, surrogate pairs, combining/ZWJ sequences, fences, delimiters, tables, links and reference definitions.
- [ ] Final streamed semantics equal a fresh parse. During streaming, define unstable-tail policy and preserve earlier blocks except where syntax or reference dependencies actually change them.
- [ ] Compare incremental edits/undos with fresh parses after adding/removing definitions before and after their uses, inserting earlier blocks and changing extension options.
- [ ] Exercise cancellation, rapid document replacement, disposal, many simultaneous documents, deep nesting, failed loads and WASM memory growth.

Exit: deterministic semantic/invalidation traces and bounded lifetime, with no stale-result publication.

### M4. Package and paired consumer rollout

- [ ] Ship the semantic API, types, grammar/resolver artifacts, notices and versioned fixture contract together.
- [ ] Extend existing package-consumer checks rather than creating another runtime bootstrap. Use the same compatible runtime artifact pin in bubli and Singapore; independently verify deduplication in each realm.
- [ ] Retest host-first, Markdown-first, concurrent initialization, worker/main-thread loads and continued non-Markdown parsing in Node, Bun and browser builds.
- [ ] Publish the exact revision/artifact handoff in the coordination page and consume it in Singapore and bubli before Fregat changes its CI/lockfile pins.

Exit: fresh-install consumer evidence for the released artifacts, followed by paired consumer updates. Marked removal happens in bubli, not here.

## Checks and evidence

Existing entry points: `bun run check`, `bun run test:package`, focused `npm test`, `sh scripts/check-native.sh` and `sh scripts/check-cursor.sh`, subject to the current manifest and documented prerequisites. Add named semantic and stream suites to the repository's own check workflow. Do not claim they already exist.

Record parse, semantic conversion, transfer, memory, cold load and incremental update costs separately. Renderer FPS and React reconciliation belong to downstream evidence. Keep warm/cold conditions, source size, viewport, CPU/runtime and corpus hashes with measurements; retain a failing control.

## Dependencies and completion

M0 precedes M1; M1 enables bubli and Singapore prototypes in parallel with M2/M3. All M1-M4 gates are required for production parser cutover. The existing `tree-sitter-x` extension ABI is reused. Open a runtime change only for a demonstrated missing export or lifetime defect, with a minimal reproduction and a link from this plan; a speculative runtime rewrite is not a dependency.

Completion requires passing semantic/profile tests, release/consumer evidence and updated companion pins. Merging this planning PR alone satisfies none of those implementation gates.
