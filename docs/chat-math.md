# CHAT math contract

`math: true` selects a separate CHAT block grammar. `math: false` retains the base
Markdown grammar and its ordinary lazy paragraph continuations. Profiles belong
to each document; scanner state is not shared between documents.

## Dollar policy

Inline math keeps the existing double-dollar policy, for example `p $$x$$ q`.
Single-dollar text such as `$x$` or `Costs $5 today` stays literal. Streamdown
[documents this choice to avoid currency conflicts](https://github.com/vercel/streamdown/blob/4c55fad1bb739fba788b1f55bbe878983243edf0/apps/website/content/docs/plugins/math.mdx#currency-vs-math).
Its [math plugin](https://github.com/vercel/streamdown/blob/4c55fad1bb739fba788b1f55bbe878983243edf0/packages/streamdown-math/index.ts)
also defaults `singleDollarTextMath` to false. This release does not enable
single-dollar math or change the inline delimiter resolver.

The flow contract follows remark-math 6.0.0, micromark-extension-math 3.1.0, and
mdast-util-math 3.0.0 with `singleDollarTextMath: false`. These are behavioral
references, not bundled runtime dependencies.

## Flow blocks

A line-start run of at least two dollars opens flow math when the rest of the
opening line has no dollar. Up to three spaces may precede the run after container
prefixes. Its suffix becomes nullable `meta`, with string escapes and entities
decoded. Subsequent lines form the opaque `value`. Block nodes always include
`meta`; inline nodes remain value-only.

A closing line has at least the opening run's width and only whitespace after the
run. Missing quote or list prefixes end the block before that line. The remaining
text is parsed under its actual surviving container, not retained as lazy math.
Headings, links, lists, and definitions inside the body remain raw math text.

Ranges use original UTF-16 coordinates. A full container prefix received at EOF
belongs to the container but is excluded from the math range. An unfinished block
at eligible source EOF becomes `pendingMath` in open presentation. Container exit
does not make it pending. Ended presentation keeps exact `math`.

## Source inventory

| Classification | Local files | Source and revision | Local change and reason |
| --- | --- | --- | --- |
| Upstream-derived grammar and scanner | `grammar/grammar.js`, `grammar/src/scanner.c`, `grammar/chat/` | tree-sitter-markdown v0.5.3, `tree-sitter-markdown/grammar.js` and `tree-sitter-markdown/src/scanner.c`, MIT | CHAT extends the existing fork and conditionally adds concrete flow tokens, width serialization, and paragraph interruption. Normal container matching owns nonlazy exits; base parsing stays unchanged. |
| Generated output and support headers | `grammar/chat/src/` | tree-sitter CLI 0.26.9, MIT | The actual generator emits parse tables, grammar metadata, and support headers for CHAT. No generated file is edited by hand. |
| Original adapters | `grammar/chat/grammar.js`, `grammar/chat/scanner.c`, `src/semantic.c`, `src/document.c`, `src/footnote.c`, `src/ids.h`, `js/`, build/package wiring, and tests | Original tree-sitter-md work | Profile selection, exact math payload/range mapping, raw-body isolation, packaged assets, and original regression fixtures. Existing cmark string decoding is reused; no remark-math or Streamdown implementation is copied. |
| Behavioral references only | No copied source | remark-math 6.0.0 `lib/index.js`; micromark-extension-math 3.1.0 `lib/math-flow.js` and `lib/math-text.js`; mdast-util-math 3.0.0 `lib/index.js`; Streamdown `4c55fad1bb739fba788b1f55bbe878983243edf0` paths linked above | Pinned semantics and currency rationale, checked independently of the implementation. |

The scanner wrapper includes the upstream-derived common scanner rather than
copying a second implementation. Generated support headers retain Tree-sitter's
[MIT notice](../licenses/tree-sitter.txt); the grammar retains Matthias Deiml's
[MIT notice](../licenses/tree-sitter-markdown.txt). [NOTICE.md](../NOTICE.md)
records packaged third-party attribution. `npm run generate` regenerates both
profiles; `bun run build` compiles the resolver and both grammar WASMs.
