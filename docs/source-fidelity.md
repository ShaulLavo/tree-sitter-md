# Inline source metadata

Exact semantics and open/ended presentation snapshots retain canonical CommonMark
`value` and `url` fields. Consumers that need literal source use these additional
required fields instead.

- Inline `code` has `sourceValue`. The producer removes matching backtick runs,
  container markers and required continuation indentation. It preserves extra
  spaces, tabs and CR/LF/CRLF. Lazy continuation whitespace remains content.
- A code body loses one leading and trailing padding unit only when both ends
  are a space or line ending and the body contains non-padding content. CRLF is
  one unit. All-whitespace bodies remain intact. Open presentation code removes
  no invented closing run. Unicode and NUL use the existing semantic policy.
- Completed `link` nodes have `origin` equal to `markdown`, `autolink` for angle
  autolinks, or `gfm-autolink` for bare URLs, www links and email links. Pending
  links and images do not claim an origin.
- `gfm-autolink` links also have `sourceValue` for literal display text and
  `sourceUrl` for the literal destination. The latter adds `http://` for www
  links and `mailto:` for email links. Entities are not decoded in these fields.
  Canonical `url` and child text still use the existing normalization.

For example, code sources "`a\n b`" and "`a\n  b`" both have canonical value
"a b", but sourceValue "a\n b" and "a\n  b" respectively. The quoted source
"> `a\n>  b`" has sourceValue "a\n b".

The bare URL `https://example.test/a?a=1&amp;b=2` keeps `&amp;` in its source
fields. Its canonical URL still contains `&`. Explicit Markdown destinations
continue to decode entities and have origin `markdown`.

Outer `range` fields remain authored UTF-16 coordinates, including delimiters
and any intervening container prefixes. Origin identifies the producer parse
path, not whether a particular downstream transform supplies positions. No
position is removed, including links inside unmatched brackets. Consumers own
any selective position policy.

Footnote literal extraction follows the existing recursive body-to-source maps.
Each footnote owner keeps its parsed container steps and removes only its own
required prefix from authored physical lines. Inner code containers are stripped
after this mapping, so lazy indentation is not lost in the canonical body copy.
Canonical body extraction and its range maps are unchanged.
