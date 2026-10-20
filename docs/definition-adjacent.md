# Definition-adjacent fixes

Fixed raw CR and CRLF line endings in multiline link titles. Titles normalize
line endings before entity decoding, so an explicit `&#13;` remains intact.
Fixed lazy paragraph continuations after reference definitions leaving their
block quote too early. Preserved first-line indentation and included that
context in the inline cache key so edits agree with fresh parses. Matched outer
quote prefixes leave inner lazy indentation intact.

The focused regression fixture retains 50 saved independent-review controls
and adds 33 controls checked against cmark 0.31.2 at
`eec0eeba6d31189fd828314576494566d539b1e3`. It covers both grammars with
GFM on and off, source fidelity, insert/delete, reparse and presentation records.
A further 16 independent LF/CRLF controls cover partially matched nested quote
prefixes, including prefix insertion and undo against fully matched quotes.
Two further pre-existing nested-list differences remain owned by the semantic
compatibility plan. Their oracle expectations have not changed.

| Classification | Local files | Source and revision | Local change and reason |
| --- | --- | --- | --- |
| Upstream-derived scanner | `grammar/src/scanner.c`, base and CHAT WASMs | tree-sitter-markdown v0.5.3, MIT | Probe paragraph interruption before closing unmatched definition containers; preserve the consumed container boundary. |
| Upstream-derived inline parser | `vendor/cmark/inlines.c`, resolver and grammar WASMs | cmark 0.31.2, BSD-2-Clause | Normalize raw title line endings before HTML entity decoding. |
| Original resolver and tests | `src/leaf.c`, `src/document.c`, `src/resolver.h`, definition-adjacent tests | tree-sitter-md | Preserve lazy first-line indentation and cache identity, with independent HTML expectations. |

Release 0.1.21 includes the landed CJK-domain and pipe-table fixes from main.
No downstream dependency pins change here.
