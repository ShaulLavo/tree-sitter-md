# Release 0.1.19

One-column GFM table headers now work with either edge pipe omitted. Both BASE
and CHAT use the corrected header scan. A delimiter row still needs a pipe, so
pipe-free setext underlines keep their heading interpretation. Each delimiter
cell requires a dash; empty delimiter cells remain paragraph text.

A rejected delimiter row keeps later table candidates inside the same paragraph.
The scanner records that decision in its serialized state and clears it when
the paragraph or its container ends. This preserves the paragraph interpretation
of the two disclosed seed219 witnesses while recognizing the 18 seed226 headers.

## Source inventory

| Files | Origin and change |
| --- | --- |
| `grammar/src/scanner.c` | Local changes to the MIT tree-sitter-markdown v0.5.3 scanner already listed in `NOTICE.md`. Track nonblank header content, require a delimiter pipe, and retain paragraph-scoped delimiter rejection. The small delimiter-state classifier is original code. |
| `grammar/chat/scanner.c` | Includes the shared scanner with the CHAT profile. No separate scanner implementation is added. |
| `tests/pipe-table-header.test.ts`, `tests/fixtures/pipe-table-*.json`, `tests/native.c` | Original regression tests. Disclosed development fixtures retain their original UTF-16 units and hashes. Saved cmark-gfm controls at `587a12bb54d95ac37241377e6ddc93ea0e45439b` establish expected behavior; no reference implementation is copied. |

## Evidence and limits

The saved pre-fix run failed 28 of its 38 focused tests. The expanded tests cover
all 20 disclosed witnesses, the 14 saved normative controls, optional edge pipes,
escaped pipes, short backtick headers, LF/CRLF, invalid delimiters, setext headings,
paragraph/container reset and incremental edit/undo against fresh parses.
Both grammar profiles are exercised, including exact/open/ended snapshots,
references, decorations, highlights, folds and injections.

The seed226 assertions certify the native table header's recognition, starting
offset and column count. They do not certify every field in Fregat's rendered
output. The two seed219 sources retain their pinned cmark-gfm paragraph result;
their disagreement with the saved remark output remains unresolved. No saved
qualification result is changed. Fregat adapter integration, repair policy,
whole-development fuzzing, heldout data and production captures are outside
this patch. No performance claim is made.

The combined checks passed 2,135 JavaScript tests, public and regression types,
676 spec examples, all 183 chat fixtures and the 497-document repository gate.
Native ASan/UBSan, resizable-memory Chromium checks and packed Node/Bun/Vite
consumers passed. Independent source compilation reproduced both shipped
grammar binaries byte-for-byte. The resolver binary stays unchanged from 0.1.17. The container-state fix from
[0.1.18](RELEASE-0.1.18.md) is included unchanged.
