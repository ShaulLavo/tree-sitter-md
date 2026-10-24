---
"tree-sitter-md": patch
---

Fixed mixed `~`, `*` and `_` delimiter ownership with `cjk: true` and `gfm: true`. Resolution follows the first encountered construct and preserves closed-span and link-label boundaries.
