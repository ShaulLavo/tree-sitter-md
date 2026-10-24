---
"tree-sitter-md": patch
---

Fixed a closing code fence followed by whitespace at the end of input producing a parse error, and `<!-->` and `<!--->` HTML blocks swallowing the content after them. The `*` and `_` scanners now return early when no token is valid. These are the applicable scanner fixes from tree-sitter-markdown v0.5.4.
