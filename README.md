# tree-sitter-md

Markdown for editors on [tree-sitter-x](https://github.com/ShaulLavo/tree-sitter-x),
with a tree-sitter block grammar and a C CommonMark + GFM inline resolver.

Install the package and its pinned tree-sitter-x host runtime:

```sh
npm install github:ShaulLavo/tree-sitter-md#main web-tree-sitter@github:ShaulLavo/tree-sitter-x#aab7db1518c19f61c1b13ec3f832b881cf5f1385
```

```js
import { init, MarkdownDocument } from 'tree-sitter-md'

await init()
const doc = new MarkdownDocument({ gfm: true, cjk: true, math: true })
doc.setText('**outside *inside')
const exact = doc.semantics()
const live = doc.presentation({ input: 'open' })
const ended = doc.presentation({ input: 'ended' })
doc.dispose()
```

- [API usage and source ownership](docs/usage.md)
- [Build, tests, benchmarks, and licensing](docs/development.md)

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
