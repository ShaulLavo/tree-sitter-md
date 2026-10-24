# Source fidelity

What `range` means on each node, and which fields keep literal source next to the canonical CommonMark values. All offsets are original UTF-16 code units, including delimiters and container prefixes.

## Block ranges

- A paragraph or container range includes the authored spaces and tabs on its final content line. It excludes the following line ending and any blank continuation lines.
- Inline ranges describe their own content.
- A table row starts at its first authored pipe or content and keeps its authored horizontal suffix. Leading table indentation belongs outside the table and each row.
- A table cell range includes padding and pipe delimiters. A separator pipe starts the following cell. The first and last cells own the optional edge pipes. Cell text and `value` stay trimmed, and an escaped pipe stays literal content. A cell the source did not write has `range: null`.
- An empty nested list marker is literal paragraph content when its parent list interrupts a paragraph. In a standalone list, or after a blank line, empty nested items stay, including items on the parent's opening line. Populated nested items are valid in both cases.
- After a reference definition, a list container that fails to match returns its consumed indentation before it closes. An under-indented quote therefore leaves the list.

## Inline source metadata

Exact semantics and open and ended presentation snapshots keep the canonical CommonMark `value` and `url` fields. These additional fields carry the literal source.

### Inline code

`code` nodes have `sourceValue` and `sourceMap`.

- `sourceValue` is the content between the backtick runs, with container markers and required continuation indentation removed. It keeps extra spaces, tabs, and CR, LF and CRLF line endings. Whitespace from a lazy continuation line stays.
- The canonical `value` removes one leading and one trailing padding unit, but only when both ends are a space or line ending and the body has non-padding content. CRLF is one unit. A body that is all whitespace stays intact.
- An open presentation of unfinished code removes no invented closing run.
- `sourceMap` maps `value` back to token offsets: `{ value, tokenLength, runs }`, where each run is `{ kind: 'copy' }` or `{ kind: 'atom' }` with value and token offsets and lengths.

The sources `` `a\n b` `` and `` `a\n  b` `` both have the canonical value `a b`. Their `sourceValue` is `a\n b` and `a\n  b`. Inside a block quote, `` > `a\n>  b` `` has `sourceValue` `a\n b`.

### Links

A completed `link` has `origin`:

| `origin` | Source |
| --- | --- |
| `markdown` | `[text](destination)` and reference links. |
| `autolink` | An angle autolink. |
| `gfm-autolink` | A bare URL, `www.` link or email. |

Pending links and images have no `origin`.

A `gfm-autolink` also has `sourceValue` (the literal display text) and `sourceUrl` (the literal destination). `sourceUrl` adds `http://` for `www.` links and `mailto:` for email. Entities are not decoded in these two fields. For `https://example.test/a?a=1&amp;b=2`, both source fields keep `&amp;`, and the canonical `url` is `https://example.test/a?a=1&b=2`. Explicit Markdown destinations decode entities and have origin `markdown`.

`origin` names the parse path that produced the link. It does not say whether a downstream transform supplies positions. No position is removed, including for links inside unmatched brackets.

### Footnotes

Footnote body extraction follows the same recursive source maps. Each footnote owner keeps its parsed container steps and removes only its own prefix from the authored lines. Inner code containers are stripped after this mapping, so lazy indentation is not lost in the canonical body copy.

### Attention flanking beside lone surrogates

Emphasis flanking reads the original UTF-16 neighbor when the parser's UTF-8 replacement character came from a lone surrogate. An authored U+FFFD keeps its Unicode category, and a valid surrogate pair is one scalar. This applies to decorations, `semantics()` and `presentation()`.
