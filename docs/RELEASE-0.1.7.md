# Release 0.1.7

Added `MarkdownDocument.presentation({ input: 'open' | 'ended' })` for owned
source-preserving snapshots. The snapshot includes the original UTF-16 source,
input mode, source revision, profile, capabilities, semantic root, and presentation
metadata. Both modes currently return exact Markdown; provisional interpretation
remains subsequent streaming-plan work.

Added recursive presentation types with pending links, images, and math. Pending
links and images have no destination. Ended snapshots retain exact semantic types.

Fixed the first `edit()` on a newly constructed empty document so it completes
without requiring an initial `setText()` call.

Native source storage retains NUL, CRLF, BOM, and surrogate units independently from
the parser's normalized buffer. Exact `semantics()`, decoration, highlighting, fold,
and injection contracts remain unchanged. Source retention adds one native UTF-16
buffer per document; presentation snapshots own their returned source and tree.
