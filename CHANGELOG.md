# Changelog

One entry per version bump of `package.json`, newest first. Dates are the commit dates of the bump. Only 0.1.0 and 0.1.1 are on npm. Every later version is installable from Git only. Generate the version list with:

```sh
git log --reverse -G'"version"' --format='%h %ad %s' --date=short -- package.json
```

## Unreleased

- CI workflow: updated pinned runtime versions (#46).

## 0.1.32 (2026-10-22)

- Fix URL hosts that end in a dot, and empty nested lists after a closed container (#45).

## 0.1.31 (2026-10-21)

- Fix block continuation after task-shaped literal text (#44).

## 0.1.30 (2026-10-21)

- Fix emphasis ranges next to lone UTF-16 surrogate units (#40).

## 0.1.29 (2026-10-20)

- Fix tab spacing on continuation lines of inline code (#43).

## 0.1.28 (2026-10-20)

- Fix lazy reference definition prefixes in nested containers (#42).

## 0.1.27 (2026-10-20)

- Fix tables inside indented quotes and footnote bodies with CR line endings (#41).

## 0.1.26 (2026-10-20)

- Fix nested list markers and block source ownership: paragraph and container ranges include trailing spaces on their last line (#39).

## 0.1.25 (2026-10-20)

- Fix explicit `http://` and `https://` autolinks: dotless hosts are links, and brackets and emphasis markers inside the URL stay part of it (#38).

## 0.1.24 (2026-10-20)

- Fix CJK emphasis next to mixed attention markers (#37).

## 0.1.23 (2026-10-20)

- Add `sourceMap` to inline `code` nodes, mapping the canonical value back to source tokens (#36).

## 0.1.22 (2026-10-20)

- Fix nested lists after definitions: partially consumed tabs keep their remaining columns, and list `spread` uses the last content boundary of the item (#35).

## 0.1.21 (2026-10-20)

- Keep paragraphs after reference definitions inside their quote. Normalize raw CR and CRLF in link titles before entity decoding (#34).

## 0.1.20 (2026-10-20)

- One-column pipe-table headers work with either edge pipe omitted. A delimiter row still needs a pipe (#32).

## 0.1.19 (2026-10-20)

- With `cjk: true`, trim CJK boundary punctuation from literal links before domain validation (#33).

## 0.1.18 (2026-10-20)

- Fix an empty list item after a definition-only block quote being read as paragraph text (#31).

## 0.1.17 (2026-10-19)

- Fix GFM literal autolink domain validation: underscore checks advance by UTF-8 scalar and run after trailing punctuation is trimmed (#30).

## 0.1.16 (2026-10-19)

- Keep list items that surround trailing container markers (#29).

## 0.1.15 (2026-10-19)

- Add the CHAT grammar, `tree-sitter-markdown-chat.wasm`, selected by `math: true`, and the `chatGrammar` option of `init()`.
- Split flow math into nullable `meta` and `value`. Flow math ends when a required container prefix is missing.
- Keep open fenced code inside its quote or list (#28).

## 0.1.14 (2026-10-19)

- GFM literal URLs consume interior Markdown delimiters before emphasis resolves, so `**see(https://exa**mple.test/a)ded**` keeps the whole URL inside the strong text (#26).

## 0.1.13 (2026-10-19)

- Recognize table headers that begin with one or two backticks or tildes (#27).

## 0.1.12 (2026-10-18)

- Add `sourceValue` to inline code, `origin` to links, and `sourceValue` and `sourceUrl` to GFM autolinks (#25).

## 0.1.11 (2026-10-18)

- End GFM tables before empty list items, ordered lists that start after one, type-7 HTML blocks and indented code blocks (#24).

## 0.1.10 (2026-10-18)

- Fix exact and presentation extraction for containers near the 200-container limit.
- Add exhaustive streaming qualification and lifecycle checks for packed Node, Bun and Vite consumers.

## 0.1.9 (2026-10-18)

- Report reference uses and their resolution in `presentation()`.
- Suppress empty trailing heading, quote, list and task markers in open presentation.
- Fix flow math that keeps TeX after the opening marker, inactive outer link openers, and the 999-character reference label limit (#21).

## 0.1.8 (2026-10-18)

- Interpret unfinished inline syntax natively in `presentation({ input: 'open' })`. Add `provisional` and `suppressed` metadata (#20).

## 0.1.7 (2026-10-18)

- Add `presentation({ input })` with the received source, mode, revision and pending node types.
- Fix the first `edit()` on a new empty document. Keep NUL, CRLF, BOM and lone surrogates in the source (#19).

## 0.1.6 (2026-10-16)

- `semantics()` decodes from an owned fixed buffer, so it works when the host uses resizable WebAssembly memory (#15).

## 0.1.5 (2026-10-16)

- Fix buffers above 2 GiB (#14).

## 0.1.4 (2026-10-14)

- Add `semantics()`: an owned tree with decoded text, resolved links, source ranges, math, CJK rules and footnotes (#13).

## 0.1.3 (2026-10-04)

- Align the `web-tree-sitter` peer range with the corrected host runtime (#10).

## 0.1.2 (2026-10-01)

- The host tree-sitter runtime becomes a required peer dependency. The package no longer depends on it (#8).

## 0.1.1 (2026-09-29)

- Import `Kind` and `CAPTURES` without loading `web-tree-sitter`.

## 0.1.0 (2026-09-26)

- First version: a block grammar and an inline resolver. The resolver was Rust (pulldown-cmark). It was replaced by the C resolver on cmark the same day, and later became a tree-sitter-x extension.
