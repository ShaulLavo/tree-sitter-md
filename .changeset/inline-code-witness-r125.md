---
"tree-sitter-md": patch
---

Breaking: Added required `sourceMap` witnesses to inline code, with token-relative UTF-16 copy and local transformation runs for `sourceValue`. Hand-authored inline code nodes must include the map; consumers can derive its type from `SemanticInline`.
