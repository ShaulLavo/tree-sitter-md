# Vendored sources

- `cmark/`: commonmark/cmark 0.31.2, commit `eec0eeba6d31189fd828314576494566d539b1e3`.
  Inline parsing, references, nodes, scanners, character classes, buffers, UTF-8, case folding,
  entity decoding. No block parser or renderers. The linker discards unused node APIs.
- `tree-sitter/`: the tree-sitter 0.27.0 C API header (`include/tree_sitter/api.h`) only. The
  runtime comes from the host, tree-sitter-x, and is not vendored.
- `src/autolink.c` and the tilde branches of `cmark/inlines.c`: ported from github/cmark-gfm
  extensions at `499789b49373bfa045d0e7547e5ee63444c77bca`. No GFM core or other extensions.

The changes against cmark 0.31.2 are also collected in [`cmark.patch`](cmark.patch), a zero-context
patch suitable for `git apply --unidiff-zero`.

## cmark adaptations

`cmark_node` stores byte start/end and link-label start/end, separate from rendered text and
line/column positions. The adapter maps bytes back to document UTF-16 offsets, including
container prefixes. `cmark_parse_inlines` takes a single leaf, with no block pass or virtual
indentation. Reference destination scanners accept leaf EOF; an empty unbracketed destination
still fails. Reference maps report every normalized lookup, including unsuccessful lookups.

Optional inline presentation uses the existing delimiter and bracket owners to interpret
eligible unfinished syntax at the received leaf EOF. The ordinary inline path keeps exact
semantics. Bracket matching checks each opener's active state, so a later bracket cannot
reactivate an outer opener after a nested link invalidates it.

`cmark_parse_inlines` accepts an optional `cmark_reference_uses` output. It records native
full, collapsed, shortcut, image, and footnote reference decisions with owned normalized
identifiers and body-relative byte spans. Explicit-label ownership removes duplicate
shortcut retries after full-reference rollback. Failed inline-destination probes produce
no unresolved shortcut record. Latent nested references remain dependencies even when
the current outer link contains their literal syntax. Callers map the records to document
coordinates, then release them with `cmark_reference_uses_free`; ordinary callers pass
`NULL`. The journal retains no node or bracket pointers. The semantic and footnote readers
share the reference normalizer and the 999-character label bound.

Tilde delimiters match equal runs of one or two, following the GFM extension's `match` and
`insert` rules. They share CommonMark's delimiter processing while bypassing its rule of three.
Autolink matching uses the extension's host, domain, punctuation and email rules on contiguous
unclaimed text. HTTP and HTTPS are enabled; FTP stays literal, matching micromark's GFM behavior.
Email candidates preceded by `/` stay literal, matching the existing corpus contract.

Optional CJK flanking follows markdown-cjk-friendly 2.0.1 and its util 3.0.1,
with get-east-asian-width 1.7.0 and Unicode 17.0 category tables. Double-dollar
inline math and callback-resolved footnote references retain their source spans
and literal data. Their host display and safe rendering remain consumer policy.

The backtick search retains the furthest observed closer for each run length. Without this,
an unsuccessful long-run search followed by a successful shorter span can overwrite the cached
last closer and make a later valid span disappear. `tests/resolver.mjs` covers this case.

The buffer overflow path aborts without printing. This removes a `stderr` data import from the
side module and does not affect successful parsing. Generated export/config/version headers
are checked in; `allocator.c` supplies the system C allocator. Notices are in `licenses/`.

## Tree-sitter cursor correction

The host runtime (tree-sitter-x) contains a correction for byte/point first-child seeks into a hidden subtree
whose trailing invisible content covers the query. Exhausting that subtree does not exclude a
later visible sibling. A failed hidden descent advances to the next visible sibling, keeping the
already-counted child index. It climbs through hidden entries without revisiting earlier visible
children; a genuine miss restores the original cursor.

`tests/cursor-seek.c` compares both seek APIs against an independent sequential oracle, including
miss-state restoration. `tests/reference-boundaries.mjs` covers reference-definition edits and
viewport starts in invisible gaps. Run `sh scripts/check-cursor.sh` and `npm test`.
`node bench/cursor-seek.mjs --check` bounds blank-line viewport cost near the start and end of a
heading-less 1 MB document, relative to early blank-line and neighboring paragraph viewports.
