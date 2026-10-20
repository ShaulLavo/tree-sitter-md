---
"tree-sitter-md": patch
---

Fixed missing spaces after reference definitions in nested lists when a tab supplies partial indentation. Fixed paragraphs after empty block quotes being rendered as tight list content despite a separating blank line.

Improved semantic extraction of deeply nested lists and quotes by calculating each container's spread boundary once per extraction.
