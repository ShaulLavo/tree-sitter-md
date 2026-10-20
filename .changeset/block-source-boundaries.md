---
"tree-sitter-md": patch
---

Fixed empty same-line nested list markers being parsed as empty lists and under-indented quotes staying inside lists after reference definitions. Fixed paragraph and container ranges dropping authored trailing whitespace, and table-cell ranges dropping their padding and pipe ownership while retaining exact inline content ranges. Fixed table-row ranges to exclude leading indentation before their authored pipe or content.
