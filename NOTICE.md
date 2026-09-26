# Notices

tree-sitter-md is MIT licensed. See `LICENSE`. Compiled-in and ported third-party work retains
the notices in `licenses/`.

| Project | License | Used as |
| --- | --- | --- |
| [tree-sitter-markdown](https://github.com/tree-sitter-grammars/tree-sitter-markdown) v0.5.3 | MIT, 2021 Matthias Deiml | Block grammar and external scanner in `grammar/` |
| [tree-sitter](https://github.com/tree-sitter/tree-sitter) 0.27.0 | MIT, 2018 Max Brunsfeld | C runtime in `vendor/tree-sitter/` |
| [cmark](https://github.com/commonmark/cmark) 0.31.2 | BSD-2-Clause, 2014 John MacFarlane; bundled MIT components | Inline parser and dependencies in `vendor/cmark/` |
| [cmark-gfm](https://github.com/github/cmark-gfm) `499789b49373bfa045d0e7547e5ee63444c77bca` | BSD-2-Clause; bundled MIT components | Strikethrough in the inline delimiter pass; autolink literals in `src/autolink.c` |
| [wasi-libc](https://github.com/WebAssembly/wasi-libc) `2e6fb9d8ee0cdf9e431fbcabe8af3115de000a13` | MIT option; musl MIT; cloudlibc BSD-2-Clause; dlmalloc CC0 | C library and allocator from WASI SDK 34 |

The cmark notices include its Houdini, buffer and utf8proc licenses. The SDK's libc notices are
in `wasi-libc.txt`, `musl.txt`, `cloudlibc.txt` and `dlmalloc.txt`.

Benchmark inputs, outside the npm package: `bench/spec/gfm-spec.txt` is the cmark-gfm spec,
CC-BY-SA 4.0, John MacFarlane. `bench/web/lezer.min.js` bundles `@lezer/markdown` and
`@lezer/common`, MIT, Marijn Haverbeke. `bench/docs/` holds text from the
[Platform](https://github.com/ShaulLavo/platform) repository: `AGENTS.md`, and `docs/` + `plans/`
concatenated and cut at 1,000,143 characters, the files Plan 176 measured.
