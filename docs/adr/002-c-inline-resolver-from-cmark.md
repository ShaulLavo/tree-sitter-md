# 002. Resolve inlines with cmark's inline pass, in C

Status: accepted
Date: 2026-09-26

## Context

The first version of the resolver was Rust. It ran each leaf block through pulldown-cmark 0.13.4, which has no entry point for "one leaf's inline content". The resolver therefore re-indented continuation lines by four virtual spaces and added a virtual first line for headings and table cells, so that pulldown-cmark's block pass would not start a block inside a leaf. Edge cases remained, such as an HTML tag whose `>` opens a continuation line. The Rust build also carried its own copy of the tree-sitter C runtime.

The editor target is a browser, so payload size and cold-load cost matter.

## Decision

Vendor cmark 0.31.2's inline pass and its required dependencies into `vendor/cmark/`, add cmark-gfm's strikethrough and autolink-literal rules, and write the resolver in C. `inline_resolve` takes one leaf's UTF-8 content, a byte-to-document mapping, the definitions and the options. It runs no block pass and inserts no virtual indentation.

## Alternatives considered

- **Keep the Rust resolver on pulldown-cmark.** It already passed 672 of 676 spec examples. It lost on the virtual-indentation trick and on size.
- **Write an inline parser from scratch.** Reimplementing CommonMark's inline rules and then keeping them in step with the spec costs more than adapting the reference implementation.

## Consequences

- The resolver follows the CommonMark reference implementation by construction. `bun run check` compares its output with micromark on every spec example and on two corpora. See [Supported syntax](../reference/syntax.md#conformance).
- Both builds measured on 2026-09-26 (Rust from commit `4214f0c`, C from `ab37152`, `-O3`): 561,739 bytes raw and 193,422 gzip for Rust, 377,481 raw and 129,730 gzip for C. The 1 MB keystroke median was 0.442 ms for Rust and 0.401 ms for C. The 46 KB cold first frame in Chromium was 1.2 ms slower in C.
- Adaptations to cmark are local patches, listed in `vendor/cmark.patch` and [Source provenance](../reference/provenance.md). They include byte-to-UTF-16 mapping, reference-use reporting, and a presentation mode for unfinished input.
- Adding cmark-gfm rules (autolink literals, tilde delimiters) is manual. There is no upstream to track for them.
