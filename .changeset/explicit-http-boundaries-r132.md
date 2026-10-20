---
"tree-sitter-md": patch
---

Fixed literal HTTP(S) links with dotless hosts and punctuation before the first dot. URL-internal emphasis markers now remain in the link. Explicit HTTP(S) text fallback excludes terminal `>` while preserving final-label underscore checks.
