# Release 0.1.15

Open fenced code stays inside its owning quote or list without shortening valid
quoted continuation ranges. CHAT flow math now ends when a required container
prefix is missing; the following line becomes a sibling at its actual owner.

Flow math separates nullable opening `meta` from body `value`. The package adds
`tree-sitter-markdown-chat.wasm` and `init({ chatGrammar })` for custom asset
loading. Math-disabled documents retain the base grammar. Inline double-dollar
math and literal single-dollar currency stay unchanged. The [CHAT contract and
source inventory](../../docs/chat-math.md) describe the syntax, profile selection, and notices.

Direct checks of the preserved implementation passed 1,942 JavaScript tests,
public types, 676 CommonMark/GFM cases, 183 chat fixtures, the 497-document pinned
repository gate, and 11,000 plus 300 incremental fuzz edits with a negative control.
Native ASan/UBSan, leaf and cursor oracles, resizable-memory Chromium, and packed
Node, Bun, and Vite consumers also passed. Hosted CI and independent review remain
release gates. This record does not claim streaming qualification or Q5 completion.

An unconfirmed math-disabled container-range observation has a separate bounded
investigation in the [streaming plan](../plans/ai-chat-streaming.md#separate-container-range-investigation).
It was not fixed or classified as pre-existing in this release-preparation unit.
