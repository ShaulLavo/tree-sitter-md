# tree-sitter-md

Markdown for editors and chat UIs on tree-sitter-x, with a block grammar and a CommonMark and GFM inline resolver.

Requires Node 24 or later, or Bun 1.4.4. Install the tree-sitter-x host alongside it:

```sh
npm install github:ShaulLavo/tree-sitter-md#main web-tree-sitter@github:ShaulLavo/tree-sitter-x#d4c988a02313fef32a307f8f254ab7a1dba18515
```

```ts
import { init, MarkdownDocument } from 'tree-sitter-md'

await init()
const doc = new MarkdownDocument()
doc.setText('# Notes\n\nSome **bold** text.\n')
for (const block of doc.semantics().root.children) console.log(block.type)
doc.dispose()
```

The current package installs from Git. It uses tree-sitter-x's `heap` and `loadExtension` exports.

- [Overview and status](docs/overview.md)
- [Streaming guide](docs/guides/stream-a-chat-reply.md)
- [API reference](docs/reference/api.md) and [compatibility](docs/reference/compatibility.md)
- [Architecture](docs/concepts/architecture.md) and [development](docs/development.md)
- [Troubleshooting](docs/troubleshooting.md) and [changelog](CHANGELOG.md)

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
