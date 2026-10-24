# Supported syntax

What the parser recognizes, which option turns each part on, and how closely it follows the specifications. All counts come from the commands in [Conformance](#conformance), run at commit `6889cfd`.

## Options

`new MarkdownDocument(options)` takes four booleans.

| Option | Default | Turns on |
| --- | --- | --- |
| `gfm` | `true` | Pipe tables, task list items, strikethrough, GFM autolink literals, footnotes. |
| `frontmatter` | `false` | A leading metadata block fenced by `---` or `+++`. |
| `cjk` | `false` | CJK-aware emphasis flanking, and CJK boundary trimming for autolink literals. |
| `math` | `false` | The CHAT profile: `$$` inline math and `$$` flow math. See [CHAT profile](chat-profile.md). |

With `gfm: false`, a pipe table is a paragraph, `~~x~~` and `www.example.com` stay text, `- [x]` stays text, and `[^1]` is not a footnote.

`semantics().profile` reports `'commonmark'` when `gfm` is false, `'gfm'` when `gfm` is true and both `cjk` and `math` are false, and `'fregat-chat'` when `gfm` is true and either `cjk` or `math` is true.

## Blocks

| Construct | Notes |
| --- | --- |
| ATX and setext headings | Levels 1 to 6. A setext underline after reference definitions applies to the paragraph that follows them. |
| Thematic breaks | |
| Indented code blocks | |
| Fenced code blocks | Backtick and tilde fences. An unclosed fence runs to the end of its container, and `semantics()` reports `fence: 'open'`. The info string is split into `language` and `meta`. |
| HTML blocks | Kinds 1 to 7, with `textarea` in kind 1 (CommonMark 0.31). Raw HTML stays data. The consumer sanitizes it. |
| Block quotes | Lazy continuation follows CommonMark. |
| Lists | Bullet markers `-`, `+`, `*`. Ordered markers `.` and `)`. `semantics()` reports `ordered`, `start`, `spread` per list and `spread` per item. |
| Reference definitions | Document-wide, first definition wins. Labels are limited to 999 characters. An edit that changes a definition invalidates exactly the cached leaves that looked up that label. |
| Pipe tables (`gfm`) | One-column tables work with either edge pipe omitted. A delimiter row needs a pipe and a dash in every cell. Alignment is `left`, `center`, `right`, or `null` per column. Cells beyond the header count are ignored. |
| Task list items (`gfm`) | `[ ]` and `[x]`. `checked` is `null` for items without a task marker. |
| Footnote definitions (`gfm`) | `[^label]: body`, with block content. |
| Frontmatter (`frontmatter`) | The closing delimiter must match the opening one. Body offsets stay in original UTF-16 units. Definitions inside metadata do not resolve body links. `semantics()` omits the block. `decorations()` reports it as `Frontmatter`. |
| Flow math (`math`) | A line starting with at least two `$`. See [CHAT profile](chat-profile.md#flow-blocks). |

Containers nest to a depth of 200. A `>` or list marker past that depth is source text. Without the limit, the scanner state would overflow tree-sitter's fixed serialization buffer, and the resulting trap could damage other documents that share the runtime.

## Inlines

| Construct | Notes |
| --- | --- |
| Emphasis and strong | CommonMark 0.31.2 delimiter rules, including the rule of three. |
| Code spans | `semantics()` gives the canonical `value` and the literal `sourceValue`. See [Source fidelity](source-fidelity.md). |
| Links and images | Inline, full, collapsed and shortcut reference forms. Titles decode entities and normalize line endings. Link-in-link is rejected as in CommonMark. |
| Autolinks | Angle autolinks always. |
| Raw HTML, entities, escapes, hard and soft breaks | |
| Strikethrough (`gfm`) | One or two tildes. |
| Autolink literals (`gfm`) | `www.`, `http://`, `https://` and email. See [Autolink literals](#autolink-literals). |
| Footnote references (`gfm`) | `[^label]`. |
| Inline math (`math`) | `$$x$$`. A single `$` stays literal. |
| CJK flanking (`cjk`) | `**これは「テスト」**です` parses as strong plus text with `cjk: true` and as one text node with `cjk: false`. |

### Autolink literals

- `www.example.com` links to `http://www.example.com`. An email address links to `mailto:`.
- `http://` and `https://` links need a nonempty, valid host. A dotless host such as `https://localhost/x` is a link.
- `ftp://example.com` stays text.
- Brackets and emphasis markers inside a URL stay part of it. `https://ex**ample.com**` gives the link `https://ex**ample.com`.
- An underscore in the last two domain labels rejects the link: `https://a_b.c_d.com` is text. Hosts with more than ten dots are exempt from this rule, as in cmark-gfm.
- With `cjk: true`, CJK boundary punctuation is trimmed before domain validation. `https://example.test。` links `https://example.test`, while `www.。` and `https://foo_bar.test.。` are not links. With `cjk: false`, the `。` is part of the URL.
- Literal links do not form inside link text.

## Conformance

| Gate | Result | Command |
| --- | --- | --- |
| CommonMark 0.31.2 (652) and GFM extension (24) examples, construct lists compared with micromark | 676 of 676 | `cd bench && node spec.mjs` |
| Chat corpus, 183 messages | 183 of 183 identical, 859 constructs | `bun run check` |
| Repository corpus, 497 Markdown files | 489 identical. 36 constructs missing and 33 extra, all explained | `bun run check` |
| Incremental edit equals fresh parse | 0 failures in 11,000 edits on a 46 KB file and 300 edits on a 1 MB file. The negative control fails 10 of 10 checks | `bun run check` |
| Semantic output against rendered spec examples | All but 16 examples, each pinned by hash in `tests/semantic-gfm-differences.json` | `npm test` |

The 36 missing and 33 extra constructs in the repository corpus are 33 task-item paragraph shapes (the same in lezer) and 3 autolink literals that mdast gives no position. 
The 16 differences are 9 GFM spec examples whose expected emphasis nesting predates CommonMark 0.31.2, 5 autolink extension examples, 1 FTP example, and 1 example that needs the GFM tag filter in the test-only renderer.

`tests/spec-floor.json` fixes the per-section example counts that `spec.mjs` must meet.
