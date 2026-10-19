# Release 0.1.17

Fixed an empty list item after a definition-only block quote being read as paragraph text.
Definition interruption rules now end when their containing block closes. Definitions
and following empty markers inside the same quote retain their previous interpretation.

CommonMark 0.31.2 [list items, rule 3 and examples 284–285](https://spec.commonmark.org/0.31.2/#list-items)
permit a standalone empty item but forbid it from interrupting a paragraph. Closing
the quote ends that paragraph context. The tests preserve the same-container case.

| Classification | Local files | Source and revision | Local change and reason |
| --- | --- | --- | --- |
| Upstream-derived scanner | `grammar/src/scanner.c`, compiled base and CHAT grammars | tree-sitter-markdown v0.5.3, `tree-sitter-markdown/src/scanner.c`, MIT | Clear the fork's definition-paragraph state when its container closes so it cannot suppress an unrelated list marker. |
| Original regression tests | `tests/block-interruption.test.ts`, `tests/fixtures/block-interruption.json` | Original tree-sitter-md tests and exact development inputs | Check both grammar profiles, original UTF-16 source identities, and inside/outside definition controls. No upstream implementation was copied. |
