# One runtime experiment

**Yes, a grammar and resolver can share one side module and the main module's memory. Stock
web-tree-sitter 0.27.0 cannot run this complete resolver without an export change.**

The experiment targets the Editor's installed web-tree-sitter 0.27.0. Source inspection also
checked tree-sitter master `dcdc8cc55e5dfedfc858080835f153999a29ec40` after fetching its upstream.

- [`Language.load`](https://github.com/tree-sitter/tree-sitter/blob/v0.27.0/lib/binding_web/src/language.ts)
  calls `C.loadWebAssemblyModule`, finds `tree_sitter_*`, calls it, and returns a `Language`.
  It discards the other exports. The Emscripten loader relocates the side module into the host's
  memory and function table.
- [`exports.txt`](https://github.com/tree-sitter/tree-sitter/blob/v0.27.0/lib/binding_web/lib/exports.txt)
  exports the JS wrappers, including `ts_parser_new_wasm` and `ts_node_symbol_wasm`. Most raw C
  APIs are absent. Struct-returning C functions and the JS transfer-buffer wrappers have
  different ABIs; their names cannot just be aliased.
- The installed generated JS assigns `moduleArg` directly to `Module` and exposes
  `loadWebAssemblyModule`, `_malloc`, `_free` and `HEAPU8` on that object. The probe captures
  the loader's exports during `Language.load` with this internal hook. A supported integration
  should expose those exports through a small binding change, rather than depend on that hook.

## Reproduce

```sh
sh experiments/side-module/build.sh
node experiments/side-module/probe.mjs
sh experiments/side-module/build-resolver.sh
node experiments/side-module/check-runtime.mjs
```

Use the shared heavy-run wrapper on the shared development machine. `WASI_SDK` selects the
compiler, and `WEB_TREE_SITTER` selects an installed `web-tree-sitter.js` path. No Emscripten
SDK is needed to compile the side module: clang's PIC output and wasm-ld's `--shared` emit
`dylink.0`, memory/table/base imports and relocations understood by the Emscripten loader.

The first module contains the real block grammar/scanner and cmark inline code, without the
C tree-sitter runtime. One call to `Language.load` loads it. The host parser produces
`(document (section (paragraph (inline))))`; JS writes `**shared memory**` into host-allocated
memory and the same side module's `tsmd_probe_inline` returns one strong node. Both assertions
pass. The side module imports memory and the function table and defines neither.

The second module contains the complete C resolver plus grammar, again without the runtime.
It loads, but calling `tsmd_new` fails because the lazy dynamic import for `ts_parser_new`
cannot resolve. The audit finds 19 missing raw runtime exports, listed in
[`side-runtime.txt`](../../docs/measurements/c-resolver/side-runtime.txt). The failure is an
expected negative control, asserted by the experiment. cmark's overflow diagnostic initially
required the host's unexported `stderr`; making that abort path silent removed that dependency.

## Cost and limits

The direct route is to build web-tree-sitter with those 19 extra C exports, preserve the side
module's resolver exports in the binding, and adapt the JS wrapper to read the shared memory.
The main runtime must remain ABI-compatible with the resolver's tree-sitter 0.27.0 headers.
The host allocator serves both grammar and resolver. All trees stay in C; JS still sees records.

The complete unresolved side artifact is 233,031 bytes raw / 75,300 bytes gzip -9, versus the
standalone 377,481 / 129,730. This is an artifact comparison, **not a measured total saving**:
adding exports retains code in the main runtime and changes its payload. The existing roughly
96 KB duplicate tree-sitter code can be removed, but the exact combined gzip and cold-load cost
needs that rebuilt host. The full host rebuild and Editor integration were deliberately outside
this spike. Using the current JS wrappers instead would require a transfer-buffer adapter for
the resolver's raw C API calls and would need its own performance measurements.
