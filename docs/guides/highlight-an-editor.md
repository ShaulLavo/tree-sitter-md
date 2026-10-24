# How to highlight and fold Markdown in an editor

Feed keystrokes to a `MarkdownDocument` and read decoration records, highlight captures, folds and fence injections for the rows on screen. You need the package installed as in the [README install section](../../README.md#install).

1. Create one document per open file and load the text.

	```ts
	import { init, MarkdownDocument, Kind, CAPTURES } from 'tree-sitter-md'

	await init()
	const doc = new MarkdownDocument({ gfm: true, frontmatter: true })
	doc.setText(text)
	```

	Set `frontmatter: true` only for files that can start with a `---` or `+++` metadata block.

2. Call `reparse()` once, in idle time after `setText`. It makes the first keystroke cheap. On the 1 MB benchmark file it cuts the first keystroke from about 3.0 ms to 1.7 ms. See [Performance](../reference/performance.md).

	```ts
	requestIdleCallback(() => doc.reparse())
	```

3. Forward every change as an `edit`. Offsets are UTF-16 code units, the units of JavaScript strings.

	```ts
	doc.edit(start, oldEnd, inserted) // replaces [start, oldEnd) with inserted
	```

4. Read records for the rows you paint. Each decoration is `[start, end, kind, extra]` in a flat `Uint32Array`.

	```ts
	const records = doc.decorationsForRows(firstRow, lastRow + 1)
	for (let i = 0; i < records.length; i += 4) {
		const [start, end, kind, extra] = records.subarray(i, i + 4)
		if (kind === Kind.Heading) paintHeading(start, end, extra) // extra is the level
	}
	```

5. Read highlight captures, folds and fence injections for the same range.

	```ts
	const captures = doc.highlights(from, to) // [start, end, capture]; CAPTURES[capture] is the name
	const folds = doc.folds(from, to) // [start, end]
	const fences = doc.injections(from, to) // [contentStart, contentEnd, languageStart, languageEnd]
	```

6. Call `doc.dispose()` when the file closes.

Real output of these calls for a small document, after typing `very ` inside the bold text:

````text
Heading(1)      0 8 "# Notes\n"
HeadingMark(1)  0 1 "#"
Paragraph(0)    9 67 "Some **very bold** text and a [link](https://example.com)."
Strong(0)       14 27 "**very bold**"
Link(0)         39 66 "[link](https://example.com)"
LinkText(0)     40 44 "link"
CodeBlock(1)    69 89 "```js\nlet a = 1\n```\n"
FenceMark(0)    69 72 "```"
CodeInfo(0)     72 74 "js"
FenceMark(0)    85 88 "```"
folds [ 0, 88, 69, 88 ]
fence js "let a = 1\n"
````

## Notes

- Reads for a few rows are cheap because inline constructs resolve lazily, only for the paragraphs you ask about.
- For live preview, keep `LinkText` and hide the brackets and destination around it.
- Highlighting the code inside a fence needs the language's own grammar. Take the range from `injections` and parse it with that grammar.
- Do not call `semantics()` on the typing path. It reads the whole document.
