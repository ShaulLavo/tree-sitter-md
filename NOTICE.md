# Notices

tree-sitter-md is MIT licensed. See `LICENSE`. Compiled-in and ported third-party work retains
the notices in `licenses/`.

| Project | License | Used as |
| --- | --- | --- |
| [tree-sitter-markdown](https://github.com/tree-sitter-grammars/tree-sitter-markdown) v0.5.3 | MIT, 2021 Matthias Deiml | Block grammar and external scanner in `grammar/` |
| [tree-sitter CLI](https://github.com/tree-sitter/tree-sitter/tree/v0.26.9) 0.26.9 | MIT, 2018 Max Brunsfeld | Generated CHAT parse tables and support headers in `grammar/chat/src/` |
| [tree-sitter](https://github.com/tree-sitter/tree-sitter) 0.27.0 | MIT, 2018 Max Brunsfeld | C API header in `vendor/tree-sitter/include/` |
| [cmark](https://github.com/commonmark/cmark) 0.31.2 | BSD-2-Clause, 2014 John MacFarlane; bundled MIT components | Inline parser and dependencies in `vendor/cmark/` |
| [cmark-gfm](https://github.com/github/cmark-gfm) `499789b49373bfa045d0e7547e5ee63444c77bca` | BSD-2-Clause; bundled MIT components | Strikethrough in the inline delimiter pass; autolink literals in `src/autolink.c` |
| [markdown-cjk-friendly](https://github.com/tats-u/markdown-cjk-friendly) extensions 2.0.1, util 3.0.1; [get-east-asian-width](https://github.com/sindresorhus/get-east-asian-width) 1.7.0 | MIT | CJK delimiter flanking and Unicode 17.0 category tables in the inline resolver |
| [wasi-libc](https://github.com/WebAssembly/wasi-libc) `2e6fb9d8ee0cdf9e431fbcabe8af3115de000a13` | MIT option; musl MIT; cloudlibc BSD-2-Clause; dlmalloc CC0 | C library and allocator from WASI SDK 34 |

The cmark notices include its Houdini, buffer and utf8proc licenses. The SDK's libc notices are
in `wasi-libc.txt`, `musl.txt`, `cloudlibc.txt` and `dlmalloc.txt`. Tree-sitter's Unicode helpers
retain the ICU notice in `icu.txt`. The SDK compiler runtime's Apache-2.0 license with LLVM
exceptions is in `llvm.txt`.

The CHAT grammar derives from the same MIT block grammar listed above. Its local math
rules, scanner profile, and native semantic adapter are described in the
[CHAT math source inventory](https://github.com/ShaulLavo/tree-sitter-md/blob/0eca7c03eda2545cef04ebd63436ef17fcb97340/docs/chat-math.md#source-inventory). The pinned remark-math
and Streamdown sources establish behavior only; no code from those projects is copied
into this implementation.

Local changes to the cmark inline resolver add temporary-EOF presentation mode.
It reuses native delimiter pairing, bracket ownership, destination scanning, code
normalization and configured dialect rules to build provisional nodes before
cleanup. Node presentation status and received payload length remain request-local;
the exact parser entry point keeps its ordinary interpretation.

Benchmark inputs, outside the npm package: `bench/spec/gfm-spec.txt` is the cmark-gfm spec,
CC-BY-SA 4.0, John MacFarlane. `bench/web/lezer.min.js` bundles `@lezer/markdown` and
`@lezer/common`, MIT, Marijn Haverbeke. `bench/docs/` holds text from the
[Platform](https://github.com/ShaulLavo/platform) repository: `AGENTS.md`, and `docs/` + `plans/`
concatenated and cut at 1,000,143 characters.

The adapted GFM domain validator retains the cmark-gfm attribution above.
Its local changes, the CJK boundary integration and the original regression tests are classified in
[the source provenance table](https://github.com/ShaulLavo/tree-sitter-md/blob/main/docs/reference/provenance.md).
