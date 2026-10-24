# Node types and record kinds

Three vocabularies exist. This page lists all of them.

| Vocabulary | Returned by | Section |
| --- | --- | --- |
| Block grammar node types | The tree-sitter parsers (`tree-sitter-markdown.wasm`, `tree-sitter-markdown-chat.wasm`) | [Block grammar node types](#block-grammar-node-types) |
| `semantics()` and `presentation()` node types | `MarkdownDocument.semantics()` and `presentation()` | [semantics() and presentation() node types](#semantics-and-presentation-node-types) |
| Record kinds, highlight captures | `decorations()`, `highlights()` | [Record kinds](#record-kinds) |

The grammars parse block structure only. A paragraph, heading text, table row or definition is one `inline` or single-token node. The inline structure comes from the resolver.

## Block grammar node types

`tree-sitter-markdown.wasm` has 38 named types. The math grammar adds the four `math_flow*` types, for 42. This is the complete list of the base grammar:

```text
document section atx_heading setext_heading thematic_break paragraph inline
indented_code_block fenced_code_block html_block block_quote list list_item
pipe_table reference_definition code_fence_content info_string
list_marker_dot list_marker_minus list_marker_parenthesis list_marker_plus list_marker_star
task_list_marker_checked task_list_marker_unchecked
pipe_table_header pipe_table_delimiter_row pipe_table_row
atx_h1_marker atx_h2_marker atx_h3_marker atx_h4_marker atx_h5_marker atx_h6_marker
setext_h1_underline setext_h2_underline
block_continuation block_quote_marker fenced_code_block_delimiter
```

To regenerate the list, run this in a checkout of the repository (`git clone https://github.com/ShaulLavo/tree-sitter-md`). The `grammar/` directory is not part of the installed package. Use `grammar/chat/src/node-types.json` for the math grammar.

```sh
node -e 'for (const n of JSON.parse(require("fs").readFileSync("grammar/src/node-types.json"))) if (n.named) console.log(n.type)'
```

Real output of `Parser.parse` on `# Title`, a paragraph, a pipe table, a fenced block and a definition:

```text
(document (section (atx_heading (atx_h1_marker) heading_content: (inline)) (paragraph (inline)) (pipe_table (pipe_table_header) (pipe_table_delimiter_row) (pipe_table_row)) (fenced_code_block (fenced_code_block_delimiter) (info_string) (block_continuation) (code_fence_content (block_continuation)) (fenced_code_block_delimiter)) (reference_definition (inline))))
```

| Node type | Meaning | Children and fields |
| --- | --- | --- |
| `document` | Root. | One `section` for content before the first heading, then one `section` per ATX heading that no higher-level heading contains. |
| `section` | An ATX heading and everything under it, up to the next heading of the same or higher level. | `atx_heading`, blocks, nested `section`. |
| `atx_heading` | `# text`. | `atx_h1_marker` to `atx_h6_marker`. Field `heading_content`: `inline`. |
| `setext_heading` | Text over `===` or `---`. | Field `heading_content`: `paragraph`. Then `setext_h1_underline` or `setext_h2_underline`. May start with `reference_definition` nodes. |
| `thematic_break` | `***`, `---`, `___`. | |
| `paragraph` | A run of text lines. | `inline`, `block_continuation`. |
| `inline` | The text of a paragraph, heading, definition or table content. A leaf for the resolver. | `block_continuation` for container prefixes on later lines. |
| `indented_code_block` | Four-space code. | |
| `fenced_code_block` | Backtick or tilde fence. | `fenced_code_block_delimiter` (open and close), `info_string`, `code_fence_content`. |
| `html_block` | HTML block kinds 1 to 7. | `block_continuation`. |
| `block_quote` | `>` container. | `block_quote_marker`, blocks. |
| `list`, `list_item` | A list and its items. | `list_marker_dot`, `list_marker_minus`, `list_marker_parenthesis`, `list_marker_plus` or `list_marker_star` per item. Task markers `task_list_marker_checked` and `task_list_marker_unchecked`. |
| `pipe_table` | A GFM table. | `pipe_table_header`, `pipe_table_delimiter_row`, `pipe_table_row`. Each is a single token. The resolver splits cells. |
| `reference_definition` | `[label]: destination "title"`. | `inline`. |
| `block_continuation` | The container prefix at the start of a continuation line (for example `> `). | |

### Added by the math grammar

`tree-sitter-markdown-chat.wasm` is selected when `math: true`. See [Math](math.md).

| Node type | Meaning |
| --- | --- |
| `math_flow` | A `$$` block. Children: `math_flow_delimiter`, `math_flow_meta`, `math_flow_content`, `block_continuation`. |
| `math_flow_delimiter` | The opening or closing run of dollars. |
| `math_flow_meta` | The text after the opening run. |
| `math_flow_content` | The body lines. |

## semantics() and presentation() node types

`semantics()` and `presentation()` return a tree of plain objects, not tree-sitter nodes. Every node has a `type` string. The authoritative definitions are `js/semantic.d.ts`, and the fields of each node are in [Snapshots](snapshots.md). This is the complete list of `type` values:

| Level | `type` values |
| --- | --- |
| Root | `root` |
| Block | `paragraph`, `heading`, `quote`, `list`, `code`, `html`, `math`, `thematicBreak`, `table`, `definition`, `footnoteDefinition` |
| Block child | `listItem` (in `list.items`), `tableRow` (in `table.rows`), `tableCell` (in `tableRow.cells`) |
| Inline | `text`, `html`, `math`, `code`, `emphasis`, `strong`, `delete`, `break`, `link`, `image`, `footnoteReference` |
| `presentation({ input: 'open' })` only | `pendingLink`, `pendingImage`, `pendingMath` (inline), `pendingMath` (block) |

The names differ from the block grammar's. A `heading` has `depth` 1 to 6 where the grammar has `atx_h1_marker` to `atx_h6_marker`, a `quote` is a `block_quote`, and a `delete` is strikethrough. `html`, `math` and `code` exist at both levels.

To regenerate the list, run this in a checkout or in the installed package (use `node_modules/tree-sitter-md/js/semantic.d.ts` there):

```sh
grep -oE "type: '[A-Za-z' |]+'" js/semantic.d.ts | sed "s/type: //" | tr -d "' " | tr '|' '\n' | sort -u
```

## Record kinds

`decorations(from, to)` and `decorationsForRows(fromRow, toRow)` return a flat `Uint32Array` of `[start, end, kind, extra]` records. Offsets are UTF-16 code units. Records come in tree order, and the inline records of a block follow the block. `Kind` is exported from the package root. `js/constants.js` has no imports, so a bundler that honors `sideEffects: false` can import `Kind` without loading `web-tree-sitter`.

| Kind | Value | `extra` |
| --- | ---: | --- |
| `Paragraph` | 1 | 0 |
| `Heading` | 2 | Level, 1 to 6. |
| `ThematicBreak` | 3 | 0 |
| `CodeBlock` | 4 | 1 if fenced. |
| `BlockQuote` | 5 | 0 |
| `List` | 6 | 1 if ordered. |
| `ListItem` | 7 | 0 |
| `Task` | 8 | 1 if checked. |
| `HtmlBlock` | 9 | 0 |
| `Definition` | 10 | 0 |
| `Table` | 11 | Column count in the low byte, then 2 bits per column starting at bit 8: 0 none, 1 left, 2 center, 3 right. A two-column `:-` and `-:` table gives `2 \| 1 << 8 \| 3 << 10` = 3330. |
| `Emphasis` | 12 | 0 |
| `Strong` | 13 | 0 |
| `Strikethrough` | 14 | 0 |
| `CodeSpan` | 15 | 0 |
| `Link` | 16 | 0 |
| `Image` | 17 | 0 |
| `HtmlInline` | 18 | 0 |
| `HardBreak` | 19 | 0 |
| `Frontmatter` | 20 | 0 |
| `HeadingMark` | 32 | The heading level. |
| `ListMark` | 33 | 0 |
| `QuoteMark` | 34 | 0 |
| `FenceMark` | 35 | 0 |
| `CodeInfo` | 36 | 0 |
| `TaskMark` | 37 | 0 |
| `TableDelimiterRow` | 38 | 0 |
| `LinkText` | 39 | 0. The text inside the brackets of a link or image. |

Kinds 1 to 20 are constructs. Kinds 32 and up are marks inside a construct.

## Highlight captures

`highlights(from, to)` returns sorted `[start, end, capture]` triples. `CAPTURES[capture]` gives the name. Capture 0 is `null`.

| Id | Name |
| ---: | --- |
| 1 | `text.title` |
| 2 | `punctuation.special` |
| 3 | `text.literal` |
| 4 | `punctuation.delimiter` |
| 5 | `text.uri` |
| 6 | `text.reference` |
| 7 | `string.escape` |
| 8 | `text.emphasis` |
| 9 | `text.strong` |

## Folds and injections

| Method | Record | Content |
| --- | --- | --- |
| `folds(from, to)` | `[start, end]` | Multi-line sections, fences, quotes, list items, tables, HTML blocks and (with `math: true`) flow math that intersect the range. |
| `injections(from, to)` | `[contentStart, contentEnd, languageStart, languageEnd]` | The content and info-string language of each fenced code block. The embedded language needs its own grammar. |
