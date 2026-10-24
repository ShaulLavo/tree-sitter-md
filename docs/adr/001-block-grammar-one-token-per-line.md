# 001. Tokenize the block grammar one line at a time

Status: accepted
Date: 2026-09-26

## Context

The block grammar is a fork of [tree-sitter-markdown](https://github.com/tree-sitter-grammars/tree-sitter-markdown) v0.5.3. Upstream tokenizes every word of a paragraph so that GLR can recognize link reference definitions inside the grammar. That makes each paragraph a chain of repeat nodes. An incremental reparse could not reuse those chains, so editing one word invalidated far more of the tree than the edit touched.

tree-sitter-md needs cheap edits in large documents, and it already needs inline parsing that tree-sitter's grammar language handles badly: delimiter matching, bracket precedence, document-wide definitions.

## Decision

The grammar emits one `_text` token per line. The lines of a paragraph or definition, and the content of an ATX heading, become one `inline` node. The info string, table rows and table cells are single tokens. HTML blocks of kinds 1 to 5 keep word tokens, because their end condition is a substring inside a line. The resolver, not the grammar, reads inline structure.

The scanner validates leading reference definitions with cmark before it recognizes a setext heading, so definitions need no per-word tokens.

## Alternatives considered

- **Keep upstream's per-word grammar.** It is the obvious choice and keeps upstream merges cheap. It lost because of the node chains described above.
- **Parse inline structure in the grammar.** CommonMark's inline rules (the rule of three, link-in-link deactivation, precedence between brackets and code spans) are stack algorithms. cmark already implements them, so the grammar leaves them alone.

## Consequences

- The block tree has no emphasis, link or code-span nodes. A host that wants them needs the resolver. See [Use the block grammar in another tree-sitter host](../guides/use-the-grammar-alone.md).
- The grammar is smaller: 625 parse states in the base grammar (`STATE_COUNT` in `grammar/src/parser.c`).
- The scanner links cmark (`vendor/cmark/`), so any native host must compile it too.
- Upstream changes need manual merging. Local changes are listed in [Source provenance](../reference/provenance.md).
