# Release 0.1.6

`MarkdownDocument.semantics()` now decodes its UTF-8 output from an owned fixed buffer.
Browsers reject resizable Wasm memory as a `TextDecoder.decode()` input. This keeps
semantic results available when the shared tree-sitter-x runtime uses resizable memory.

Unsigned Wasm32 offsets, fatal UTF-8 validation and native semantic buffer release
are preserved. The UTF-16 input writer is unchanged.

The browser regression uses the real runtime and Markdown resolver. It checks Unicode
semantics across memory growth and edits, and retains a result across disposal.
