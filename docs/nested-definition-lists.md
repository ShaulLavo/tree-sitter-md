# Nested definition lists

Release 0.1.22 fixes two definition-adjacent nested-list cases. Partially consumed
tabs retain their remaining virtual columns in paragraph content and map those
spaces to the authored tab. List spread uses the last content boundary owned by
the child container, so a blank after an empty quote makes the item loose while
a blank quote marker inside that quote keeps it tight.

The scanner and both grammar WASMs are unchanged. The original resolver changes
are in `src/leaf.c`, `src/document.c`, `src/resolver.h` and `src/semantic.c`.
Source-column and list-indent calculations moved unchanged from the semantic
walker into the leaf module for shared use.

The fixture file `tests/fixtures/nested-definition-lists.json` contains 40 HTML
expectations from cmark 0.31.2 at
`eec0eeba6d31189fd828314576494566d539b1e3`, plus original UTF-16LE source hashes.
The two exact recorded sources and expectations are preserved. Definition blocks
are recursively excluded only for HTML serialization, as in the existing
definition-adjacent suite. Reference resolution remains asserted by the full HTML.

```sh
node --test tests/nested-definition-lists.test.ts tests/definition-adjacent.test.ts
node --test tests/semantics.mjs tests/resolver.mjs
bun run test:types
TREE_SITTER_LIB=/path/to/tree-sitter-x/lib sh scripts/check-native.sh
```

The focused final run passed 264 tests; the semantic and related run passed
1,491 tests, with no skips. Three narrow ASan/UBSan executables passed, including
virtual-tab source mapping and quote separator ownership. Failing-first evidence
has 28 intended failures and 16 passing controls on the exact 0.1.21 base.
An intermediate candidate failed two outer-quote controls before the ownership
fix. These checks do not establish full product qualification. No downstream
package pins, comparison allowances, or installed consumers change here.
