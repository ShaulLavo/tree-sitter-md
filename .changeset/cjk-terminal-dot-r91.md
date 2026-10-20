---
"tree-sitter-md": patch
---

Fixed GFM literal links with `cjk: true` retaining terminal ASCII punctuation before CJK punctuation. Dotted-domain validation and source ranges now use the trimmed link in exact, open, and ended output.
