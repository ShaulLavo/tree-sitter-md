# How to render a document from `semantics()`

`semantics()` returns the whole document as a tree with decoded text, resolved links and source ranges. Walk it to produce HTML, terminal output, or any other view. You need the package installed as in the [README install section](../../README.md#install).

1. Parse the text and read the tree.

	```ts
	import { init, MarkdownDocument } from 'tree-sitter-md'

	await init()
	const doc = new MarkdownDocument()
	doc.setText(text)
	const { root } = doc.semantics()
	doc.dispose() // the snapshot stays valid
	```

2. Walk `root.children` by `type`. The node shapes are in [Snapshots](../reference/snapshots.md).

3. Decide what to do with raw HTML and link destinations. The parser keeps them as data. It does not sanitize.

This renderer covers the common nodes, escapes text, and replaces unsafe link schemes:

```ts
import type { SemanticBlock, SemanticInline } from 'tree-sitter-md'

const escape = (text: string) =>
	text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const safeUrl = (url: string) => (/^(https?:|mailto:|#|\/)/i.test(url) ? url : '#')

const inline = (nodes: readonly SemanticInline[]): string =>
	nodes
		.map((node) => {
			switch (node.type) {
				case 'text': return escape(node.value)
				case 'code': return `<code>${escape(node.value)}</code>`
				case 'emphasis': return `<em>${inline(node.children)}</em>`
				case 'strong': return `<strong>${inline(node.children)}</strong>`
				case 'delete': return `<del>${inline(node.children)}</del>`
				case 'link': return `<a href="${escape(safeUrl(node.url))}">${inline(node.children)}</a>`
				case 'break': return '<br>'
				default: return '' // html, image, math, footnoteReference: decide per app
			}
		})
		.join('')

const block = (nodes: readonly SemanticBlock[]): string =>
	nodes
		.map((node) => {
			switch (node.type) {
				case 'heading': return `<h${node.depth}>${inline(node.children)}</h${node.depth}>`
				case 'paragraph': return `<p>${inline(node.children)}</p>`
				case 'quote': return `<blockquote>${block(node.children)}</blockquote>`
				case 'code': return `<pre><code>${escape(node.value)}</code></pre>`
				case 'list': return `<ul>${node.items.map((item) => `<li>${block(item.children)}</li>`).join('')}</ul>`
				default: return '' // html, table, math, definition: decide per app
			}
		})
		.join('\n')
```

Run on `# Hello` and a paragraph with a safe link, an unsafe `javascript:` link and a `<script>` tag, it prints:

```html
<h1>Hello</h1>
<p>A <a href="https://example.com">safe</a> link, a <a href="#">bad</a> one, and x.</p>
```

The `<script>` tag is an `html` inline node, which the renderer drops. Its text content stays.

## Notes

- `semantics()` materializes the complete document. On a 256 KiB document it takes about 40 ms ([Performance](../reference/performance.md#reading-a-complete-document)). Run it in a worker for large files.
- Every node has `range` in original UTF-16 offsets. Use it to map a rendered element back to the source.
- To keep literal source (`sourceValue` of code spans and bare URLs), see [Source fidelity](../reference/source-fidelity.md).
