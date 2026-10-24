# How to render a streaming chat reply

Append each chunk of a model reply to a `MarkdownDocument` and read an `'open'` presentation after each one. Unfinished bold, links and math render as they will end up. You need the package installed as in the [README install section](../../README.md#install).

1. Create a document with the chat options.

	```ts
	import { init, MarkdownDocument } from 'tree-sitter-md'

	await init()
	const doc = new MarkdownDocument({ gfm: true, cjk: true, math: true })
	```

	`math: true` turns on `$$` math and selects the CHAT grammar. `cjk: true` fixes emphasis next to CJK punctuation. See [CHAT profile](../reference/chat-profile.md).

	With these options, `doc.semantics().profile` and `doc.presentation(...).profile` are `'fregat-chat'`. The name comes from Fregat, the app this configuration was built for. It is only a label for "GFM plus `cjk` or `math`", and you do not set it. See [The name `fregat-chat`](../reference/chat-profile.md#the-name-fregat-chat).

2. Append every chunk with `edit` and keep a running length.

	```ts
	let length = 0
	function append(chunk: string) {
		doc.edit(length, length, chunk)
		length += chunk.length
	}
	```

3. After each chunk, read `presentation({ input: 'open' })` and render `root`.

	```ts
	append(chunk)
	const live = doc.presentation({ input: 'open' })
	render(live.root)
	```

4. When the stream ends, read `presentation({ input: 'ended' })` once and render that. It is the exact tree, with no pending nodes.

5. Call `doc.dispose()` when the message is no longer needed. Snapshots you already hold stay valid.

Real output for a reply delivered in three chunks. A shortcut reference stays unresolved until its definition arrives, and flow math is pending until its closing line:

```text
paragraph(text "See [docs] and ", strong(text "bold"))
  provisional: unclosed-delimiter
  references:  docs=unresolved
paragraph(text "See [docs] and ", strong(text "bold text"), text ".") | pendingMath "x = 1"
  provisional: unclosed-math
  references:  docs=unresolved
paragraph(text "See ", link(text "docs"), text " and ", strong(text "bold text"), text ".") | math "x = 1" | definition
  provisional: none
  references:  docs=resolved
ended: paragraph(text "See ", link(text "docs"), text " and ", strong(text "bold text"), text ".") | math "x = 1" | definition
```

The chunks were `'See [docs] and **bold'`, `' text**.\n\n$$\nx = 1'` and `'\n$$\n\n[docs]: https://example.com\n'`.

## Notes

- Render the pending node types. `pendingLink` has the label and no destination. `pendingImage` has only `alt`. `pendingMath` has the received TeX. See [Snapshots](../reference/snapshots.md#presentation).
- An earlier block can change meaning when later text arrives, as `[docs]` does above. Re-render from the new root instead of patching the old one.
- `provisional` lists the nodes that exist only because the input is unfinished. `path` is an array of property names and indexes from the root. `suppressed` lists received markers that are withheld, such as a trailing `#` with no heading text yet.
- Each read materializes the whole message. A 32 KiB reply takes about 6 ms ([Performance](../reference/performance.md#reading-a-complete-document)). The longest of the 183 sample chat messages (8,642 UTF-16 units) takes about 1 ms.
- Fenced code stays opaque. Highlight it with the language's grammar.
