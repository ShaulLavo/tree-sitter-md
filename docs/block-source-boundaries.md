# Block source ownership

Paragraph and container ranges include authored spaces and tabs on their final content
line. They exclude following line endings and blank continuation lines. Inline ranges
continue to describe their own content.

Table-cell ranges include padding and pipe delimiters. A separator pipe starts the
following cell; the first and last cells own optional edge pipes. Leading table
indentation belongs outside the table. Cell text ranges and values stay trimmed,
escaped pipes remain literal content, and missing cells retain a null range.

An empty list marker on the opening line of another list item is literal paragraph
content. A populated marker on that line can start a nested list, and empty nested
items on later indented lines remain valid. This scanner state survives incremental
parsing in both grammar profiles.

After a reference definition, a failed list-container match must return its consumed
indentation before emitting a zero-width close token. Otherwise the next match counts
that indentation twice and retains an under-indented quote inside the list. Four saved
list/quote layouts cover this closure in both grammar and GFM profiles, with LF, CRLF
and CR inputs, open and ended reads, and incremental edits.

`tests/block-boundaries.test.ts` uses the 28 saved block witnesses from r122. The
fixtures retain original UTF-16 source hashes, independent expected positions and
source-line metadata. These are focused native checks, not a full qualification run.
Live table tests check the corrected table start and complete header-cell ranges.
Fregat's prepared live source can remove a final unmatched delimiter, so its table
end offset requires the separate application-level comparison. The original strict
whole-row mismatches remain RED. The product is NOT VERIFIED.
