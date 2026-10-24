# 003. Load the resolver into the host's tree-sitter runtime

Status: accepted
Date: 2026-09-28

## Context

The first resolver module contained its own tree-sitter runtime, with the grammar compiled in. An editor that already runs `web-tree-sitter` for other languages then ships and runs two runtimes with two WebAssembly memories, and the Markdown tree cannot be shared with code that uses the host.

Stock `web-tree-sitter` exposes JavaScript wrappers, not the raw C API. A side module that calls `ts_node_*` and `ts_tree_*` directly cannot link against it: a spike on 2026-09-26 found 19 raw C APIs unresolved.

## Decision

Build `tree-sitter-md.wasm` as a side module with no libc and no tree-sitter runtime. It imports tree-sitter's C API and libc from [tree-sitter-x](https://github.com/ShaulLavo/tree-sitter-x), a `web-tree-sitter` fork that exports `heap` and `loadExtension` and the raw C API. The grammars load as ordinary `Language` objects. `package.json` declares `web-tree-sitter` as a required peer (`^0.28.1`) and pins a tested tree-sitter-x commit for development.

## Alternatives considered

- **Keep a private runtime inside the resolver module.** It works with stock `web-tree-sitter`, and it was the first design. It lost because it duplicates the runtime and memory and keeps trees out of the host's reach.
- **Use stock `web-tree-sitter` and cross the boundary through JavaScript wrappers.** Every node access in a record walk would cross into JavaScript. Walking trees in C is the point of the module.

## Consequences

- Users install a tree-sitter-x build. With stock `web-tree-sitter` (0.26.9 and 0.27.1 were run) the import fails with `does not provide an export named 'heap'`. See [Compatibility](../reference/compatibility.md) and [Troubleshooting](../troubleshooting.md).
- The resolver walks trees in C with no copy and shares one memory with every other language in the host.
- A resizable host memory cannot feed `TextDecoder` directly, so `semantics()` decodes from an owned fixed copy (release 0.1.6).
- Host and resolver versions must match. The tests pin one known-good tree-sitter-x commit, and compatible builds can advance independently.
