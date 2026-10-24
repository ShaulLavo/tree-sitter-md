# 004. Ship the CHAT profile as a second block grammar

Status: accepted
Date: 2026-10-19

## Context

Chat renderers need `$$` flow math, with ranges that respect quote and list containers. Flow math changes block parsing: a `$$` line can interrupt a paragraph, a missing container prefix must end the block before that line, and the scanner must serialize the opening run's width for incremental parsing.

Plain CommonMark and GFM documents must keep exact lazy-continuation and paragraph-interruption behavior. The spec gate runs on the base grammar.

## Decision

Derive a second grammar in `grammar/chat/`. `grammar/chat/grammar.js` extends the base grammar with the `math_flow` rules. `grammar/chat/scanner.c` compiles the shared scanner with `TSMD_CHAT_MATH` defined instead of copying it. `MarkdownDocument` selects the grammar per document: `math: true` uses `tree-sitter-markdown-chat.wasm`, and `math: false` uses the base grammar.

## Alternatives considered

- **Add flow math to the base grammar.** One grammar is simpler to ship. It lost because the paragraph-interruption and container-exit changes would apply to every document, including those that never use math.
- **Recognize flow math in the resolver.** The resolver sees leaf blocks, after the grammar has already decided block boundaries and container exits. Flow math has to take part in those decisions.

## Consequences

- `init()` loads both grammars even when no document uses math. The CHAT grammar is 143,368 bytes raw and 28,755 gzip.
- Two parsers to regenerate: `npm run generate` runs the tree-sitter CLI in `grammar/` and `grammar/chat/`.
- The base grammar's behavior is unchanged by math work, and the CHAT grammar has its own tests in both profiles.
- Documents never share scanner state across profiles. See [CHAT profile](../reference/chat-profile.md).
