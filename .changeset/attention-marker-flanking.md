---
"tree-sitter-md": patch
---

Fixed `cjk: true` emphasis around adjacent `*` and `_` markers, preserving literal mixed-marker runs and closing valid inner emphasis. GFM tilde, CJK punctuation and Unicode scalar neighbors retain their existing behavior.
