# Vendored sources

- `cmark/`: commonmark/cmark 0.31.2, commit `eec0eeba6d31189fd828314576494566d539b1e3`.
  Inline parsing, references, nodes, scanners, character classes, buffers, UTF-8, case folding,
  entity decoding. No block parser or renderers. The linker discards unused node APIs.
- `tree-sitter/`: tree-sitter 0.27.0 C runtime from the same Cargo registry source used by the
  Rust baseline. The runtime is compiled directly, with no Rust binding.
- `src/autolink.c` and the tilde branches of `cmark/inlines.c`: ported from github/cmark-gfm
  extensions at `499789b49373bfa045d0e7547e5ee63444c77bca`. No GFM core or other extensions.

The changes against cmark 0.31.2 are also collected in [`cmark.patch`](cmark.patch), a zero-context
patch suitable for `git apply --unidiff-zero`. The runtime omits its unused wasm-host stdlib
and has trailing whitespace normalized.

## cmark adaptations

`cmark_node` stores byte start/end and link-label start/end, separate from rendered text and
line/column positions. The adapter maps bytes back to document UTF-16 offsets, including
container prefixes. `cmark_parse_inlines` takes a single leaf, with no block pass or virtual
indentation. Reference destination scanners accept leaf EOF; an empty unbracketed destination
still fails. Reference maps report every normalized lookup, including unsuccessful lookups.

Tilde delimiters match equal runs of one or two, following the GFM extension's `match` and
`insert` rules. They share CommonMark's delimiter processing while bypassing its rule of three.
Autolink matching uses the extension's host, domain, punctuation and email rules on contiguous
unclaimed text. HTTP and HTTPS are enabled; FTP stays literal, matching micromark's GFM behavior.
Email candidates preceded by `/` stay literal, matching the existing corpus contract.

The backtick search retains the furthest observed closer for each run length. Without this,
an unsuccessful long-run search followed by a successful shorter span can overwrite the cached
last closer and make a later valid span disappear. `tests/resolver.mjs` covers this case.

The buffer overflow path aborts without printing. This removes a `stderr` data import from the
side module and does not affect successful parsing. Generated export/config/version headers
are checked in; `allocator.c` supplies the system C allocator. Notices are in `licenses/`.

## Tree-sitter cursor correction

The runtime also contains a correction for byte/point first-child seeks into a hidden subtree
whose trailing invisible content covers the query. Exhausting that subtree does not exclude a
later visible sibling. A failed hidden descent falls back to sequential visible-child traversal;
a genuine miss restores the original cursor. The fallback is linear in the queried node's visible
children, so it is a correctness safeguard rather than a claimed optimization.

`tests/cursor-seek.c` compares both seek APIs against an independent sequential oracle, including
miss-state restoration. `tests/reference-boundaries.mjs` covers reference-definition edits and
viewport starts in invisible gaps. Run `sh scripts/check-cursor.sh` and `npm test`.
