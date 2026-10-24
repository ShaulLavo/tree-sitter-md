---
"tree-sitter-md": minor
---

Renamed the "chat" grammar to "math". `tree-sitter-markdown-chat.wasm` is now `tree-sitter-markdown-math.wasm`, the `init()` option `chatGrammar` is now `mathGrammar`, `grammar/chat/` is now `grammar/math/`, and its entry point is `tree_sitter_markdown_math`. The old package path `tree-sitter-md/tree-sitter-markdown-chat.wasm` and the `chatGrammar` option still work and are deprecated until the next release. `semantics().profile` and `presentation().profile` now report `'gfm-extended'` instead of `'fregat-chat'`; this value has no alias, so update any comparison against the old string.
