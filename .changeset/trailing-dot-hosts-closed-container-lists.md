---
"tree-sitter-md": patch
---

Fixed literal URLs such as `https://example.` after an unclosed `[`: the trailing dot now counts as the host's dot and is trimmed from the link. Fixed `* *` after a paragraph inside a list item or block quote that the line closes: the second marker now opens a nested empty list.
