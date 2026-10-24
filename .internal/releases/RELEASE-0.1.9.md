# Release 0.1.9

Added native reference reporting to `presentation({ input })` in both open and
ended modes. Each use reports its normalized identifier, original UTF-16 range,
and current resolution. Reference links and images use `kind: 'link'`; footnotes
use `kind: 'footnote'`. Late, changed, duplicate, and deleted definitions update
earlier uses on the next read, including dependencies inside nested containers
and footnote bodies.

Added suppression of empty trailing heading, quote, list, and task markers in open
presentation. Received source and earlier visible siblings remain available.
Ended reads retain the exact block interpretation.

Fixed double-dollar block math to preserve TeX following the opening marker on
the same line. Fixed an inactive outer link opener that could produce nested
links after a later bracket opened. Reference labels now follow CommonMark's
999-character limit, while long link text can still use a short explicit label.
Empty task items end at their received newline, so later definitions and prose
keep their own blocks. Blank lines preserve literal task text and list spacing;
disabling GFM preserves task-shaped text in ordinary paragraphs.

The 33-fixture authored streaming matrix now passes all 364 presentation checks.
The exhaustive chunk, lifecycle, and release-baseline units of the
[AI chat streaming plan](../plans/ai-chat-streaming.md) remain open. Fregat chat
adoption has its own renderer and browser qualification gates.
