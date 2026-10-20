# Block source ownership

Paragraph and container ranges include authored spaces and tabs on their final content
line. They exclude following line endings and blank continuation lines. Inline ranges
continue to describe their own content.

Table-cell ranges include padding and pipe delimiters. A separator pipe starts the
following cell; the first and last cells own optional edge pipes. Leading table
indentation belongs outside the table. Cell text ranges and values stay trimmed,
escaped pipes remain literal content, and missing cells retain a null range.

An empty nested list marker is literal paragraph content when its parent list
interrupts a paragraph. Standalone lists and lists after blank lines retain empty
nested items, including items on the parent's opening line. Populated nested items
remain valid in either context. The scanner records paragraph interruption across
tokens on the same line and serializes it for incremental parsing in both profiles.

After a reference definition, a failed list-container match must return its consumed
indentation before emitting a zero-width close token. Otherwise the next match counts
that indentation twice and retains an under-indented quote inside the list. Four saved
list/quote layouts cover this closure in both grammar and GFM profiles, with LF, CRLF
and CR inputs, open and ended reads, and incremental edits.

`tests/block-boundaries.test.ts` uses the 28 saved block witnesses from r122. The
fixtures retain original UTF-16 source hashes, independent expected positions and
source-line metadata. These are focused native checks, not a full qualification run.
All six table witnesses check exact native ranges, including their end points.
The two seed187 live inputs explicitly expect raw table ranges 26..94 and 26..107.
Their saved prepared HAST expectations remain 26..93 and 26..106. Fregat's live
preparation removes a final unmatched delimiter, so those two application-level
comparisons remain RED. The original strict whole-row mismatches remain RED.
The product is NOT VERIFIED.
