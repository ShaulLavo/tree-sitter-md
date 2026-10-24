# Snapshots

The types returned by `semantics()` and `presentation()`. The authoritative definitions are `js/semantic.d.ts`. The complete list of `type` values is in [Node types](node-types.md#semantics-and-presentation-node-types). Every node has `range: { start, end }` in original UTF-16 code units, except padded table cells, whose `range` is `null`.

## Snapshot fields

| Field | Type | Meaning |
| --- | --- | --- |
| `revision` | number | Advances by one for each `setText` and `edit`. Reads do not change it. |
| `profile` | `'commonmark' \| 'gfm' \| 'fregat-chat'` | See [Supported syntax](syntax.md#options). |
| `capabilities` | `{ commonmark: true, gfm, math, cjk, footnotes }` | The enabled options. `footnotes` equals `gfm`. |
| `root` | `SemanticRoot` or `PresentationRoot` | The document. |

A presentation snapshot adds `input`, `source`, `provisional`, `suppressed` and `references`.

## Block nodes

| `type` | Fields |
| --- | --- |
| `paragraph` | `children` (inlines) |
| `heading` | `depth` (1 to 6), `children` |
| `quote` | `children` (blocks) |
| `list` | `ordered`, `start` (number or `null`), `spread`, `items` |
| `code` | `value`, `language`, `meta`, `fence` (`'open'`, `'closed'` or `'indented'`) |
| `html` | `value` |
| `math` | `value`, `meta` (CHAT only, nullable) |
| `thematicBreak` | none |
| `table` | `align` (`'left'`, `'center'`, `'right'` or `null` per column), `rows` |
| `definition` | `identifier`, `url`, `title` |
| `footnoteDefinition` | `identifier`, `children` |

`listItem`: `children`, `spread`, `checked` (`true`, `false`, or `null` without a task marker). `tableRow`: `cells`. `tableCell`: `children`, and `range` is `null` for a cell the source did not write.

Code `value` has no final renderer newline. Frontmatter is not part of the tree.

## Inline nodes

| `type` | Fields |
| --- | --- |
| `text`, `html`, `math` | `value` |
| `code` | `value`, `sourceValue`, `sourceMap` |
| `emphasis`, `strong`, `delete` | `children` |
| `break` | `hard` |
| `link` | `children`, `url`, `title`, `origin`. When `origin` is `'gfm-autolink'`: `sourceUrl`, `sourceValue`. |
| `image` | `alt`, `url`, `title` |
| `footnoteReference` | `identifier` |

`link.origin` is `'markdown'`, `'autolink'` (angle brackets) or `'gfm-autolink'` (`www.`, `http(s)://`, email). See [Source fidelity](source-fidelity.md) for `sourceValue`, `sourceUrl` and `sourceMap`.

## Presentation

`presentation({ input: 'ended' })` returns an exact tree: `root` is a `SemanticRoot`, and `provisional` and `suppressed` are empty arrays. `presentation({ input: 'open' })` interprets unfinished syntax at the end of the received text, and the root can contain three extra node types.

| Extra `type` | Level | Fields |
| --- | --- | --- |
| `pendingLink` | inline | `children` (the received label). No destination or title. |
| `pendingImage` | inline | `alt`. No destination or title. |
| `pendingMath` | inline and block | `value`. The block form also has `meta`. |

| Field | Type | Meaning |
| --- | --- | --- |
| `input` | `'open' \| 'ended'` | The requested mode. |
| `source` | string | The original received text, including NUL, BOM, CRLF and lone surrogates. |
| `provisional` | `{ path, reason }[]` | The nodes that exist only because the input is unfinished. `path` is an array of property names and indexes from the root. |
| `suppressed` | `{ range, reason }[]` | Received source withheld from the tree. |
| `references` | `{ kind, identifier, range, resolution }[]` | Every reference use, in source order. `kind` is `'link'` (reference links and images) or `'footnote'`. `resolution` is `'resolved'` or `'unresolved'`. |

`provisional.reason` values:

| Reason | Cause |
| --- | --- |
| `unclosed-delimiter` | Emphasis or strikethrough with no closer. |
| `unclosed-code` | A code span with no closing backtick run. The received content is kept without an invented closer. |
| `unclosed-link` | A link whose destination has not arrived. |
| `unclosed-image` | An image whose destination has not arrived. |
| `unclosed-math` | Inline or block math with no closer. |

`suppressed.reason` is `empty-trailing-marker`: a heading, quote, list or task marker with no content yet, or an ambiguous trailing inline marker. A paragraph left empty by suppression is omitted. Siblings before it stay in the tree.

Only the final open source-mapped leaf is interpreted this way, including quote and list continuations. Everything before it is exact. Reference definitions that arrive later change earlier uses on the next read. Code, math and HTML payloads stay opaque to reference interpretation, so a `[label]` inside them is not a use.

An unclosed flow-math block is `pendingMath` only at eligible end of source in an `'open'` read. In an `'ended'` read it is `math`.
