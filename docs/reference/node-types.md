# Node types and record kinds

Three vocabularies exist. The block grammars have tree-sitter node types. The resolver emits numeric record kinds and highlight captures. `semantics()` and `presentation()` return their own tree, described in [Snapshots](snapshots.md).

The grammars parse block structure only. A paragraph, heading text, table row or definition is one `inline` or single-token node. The inline structure comes from the resolver.

## Block grammar node types

`tree-sitter-markdown.wasm` (`grammar/src/node-types.json`, 38 named types). The CHAT grammar adds the four `math_flow*` types, for 42 named types. Regenerate the list with:

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

### Added by the CHAT grammar

`tree-sitter-markdown-chat.wasm` is selected when `math: true`. See [CHAT profile](chat-profile.md).

| Node type | Meaning |
| --- | --- |
| `math_flow` | A `$$` block. Children: `math_flow_delimiter`, `math_flow_meta`, `math_flow_content`, `block_continuation`. |
| `math_flow_delimiter` | The opening or closing run of dollars. |
| `math_flow_meta` | The text after the opening run. |
| `math_flow_content` | The body lines. |

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
