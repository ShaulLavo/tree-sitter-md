# Notices

tree-sitter-md has no license of its own yet. The wasm module and this repository contain work
from these MIT-licensed projects; their license texts are in `licenses/`.

| Project | Copyright | Used as |
| --- | --- | --- |
| [tree-sitter-markdown](https://github.com/tree-sitter-grammars/tree-sitter-markdown) v0.5.3 | 2021 Matthias Deiml | Block grammar and external scanner, forked in `grammar/` |
| [tree-sitter](https://github.com/tree-sitter/tree-sitter) 0.27.0 | 2018 Max Brunsfeld | Parser runtime, compiled into the wasm module |
| [pulldown-cmark](https://github.com/pulldown-cmark/pulldown-cmark) 0.13.4 | 2015 Google Inc. | Inline resolution (delimiter and bracket stacks, reference definitions), compiled into the wasm module |
| [markdown-rs](https://github.com/wooorm/markdown-rs) 1.0.0 | 2022 Titus Wormer | GFM autolink literals, ported in `src/autolink.rs` |

Benchmark inputs, not part of the package: `bench/web/lezer.min.js` bundles `@lezer/markdown` and
`@lezer/common` (MIT, Marijn Haverbeke) for comparison; `bench/docs/` holds text from the
[fregat](https://github.com/ShaulLavo/fregat) repository (`AGENTS.md`, and `docs/` + `plans/`
concatenated and cut at 1,000,143 characters), the files Plan 176 measured.
