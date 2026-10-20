---
"tree-sitter-md": patch
---

Fixed emphasis and strong ranges beside lone UTF16 surrogate units. Original source units now determine delimiter flanking while authored U+FFFD and valid supplementary characters keep their existing behavior.
