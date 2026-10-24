# How to use the block grammar in another tree-sitter host

The block grammar is an ordinary tree-sitter grammar. Use it without the resolver when you only need block structure: headings, lists, tables, fences. The tree has no inline nodes. A paragraph is one `inline` node. For inline structure, use `MarkdownDocument`.

There are no packaged bindings for Rust, Python or other languages. You load the `.wasm` file in a web host, or compile `parser.c` and `scanner.c` into a native host.

## Load the wasm grammar in TypeScript

Install `web-tree-sitter` next to the package. Regular `web-tree-sitter` 0.27.1 from npm works for the grammar alone. The package's `exports` map publishes the `.wasm` files, so you resolve the grammar the way you resolve any module:

```ts
import { fileURLToPath } from 'node:url'
import { Language, Parser } from 'web-tree-sitter'

await Parser.init()
const markdown = await Language.load(
	fileURLToPath(import.meta.resolve('tree-sitter-md/tree-sitter-markdown.wasm')),
)

const parser = new Parser()
parser.setLanguage(markdown)

const tree = parser.parse('# Title\n\nSome *text*.\n\n- [x] done\n')
console.log(tree?.rootNode.toString())
```

In a bundler, import the file as a URL instead, for example `tree-sitter-md/tree-sitter-markdown.wasm?url` in Vite, and pass that to `Language.load`.

Real output, the same on stock 0.27.1 and on the tree-sitter-x build pinned in `package.json`:

```text
(document (section (atx_heading (atx_h1_marker) heading_content: (inline)) (paragraph (inline)) (list (list_item (list_marker_minus) (task_list_marker_checked) (paragraph (inline))))))
```

Use `tree-sitter-markdown-math.wasm` for the math grammar, which adds `math_flow` nodes. The node names are in [Node types and record kinds](../reference/node-types.md).

## Compile the grammar into a native host

The scanner calls the vendored cmark to validate reference definitions, so compile `vendor/cmark/*.c` with it. This C program prints the block tree:

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <tree_sitter/api.h>

const TSLanguage *tree_sitter_markdown(void);

int main(void) {
	const char *source = "# Title\n\nSome *text*.\n\n- [x] done\n";
	TSParser *parser = ts_parser_new();
	ts_parser_set_language(parser, tree_sitter_markdown());
	TSTree *tree = ts_parser_parse_string(parser, NULL, source, strlen(source));
	char *text = ts_node_string(ts_tree_root_node(tree));
	puts(text);
	free(text);
	ts_tree_delete(tree);
	ts_parser_delete(parser);
	return 0;
}
```

Build it from a checkout of this repository and of [tree-sitter-x](https://github.com/ShaulLavo/tree-sitter-x), with `LIB` set to tree-sitter-x's `lib/` directory:

```sh
clang -std=c11 -D_POSIX_C_SOURCE=200809L -D_DEFAULT_SOURCE \
	-I$LIB/include -I$LIB/src -Igrammar/src -Ivendor/cmark \
	parse.c $LIB/src/lib.c grammar/src/parser.c grammar/src/scanner.c vendor/cmark/*.c -o parse
./parse
```

It prints the same tree as the JavaScript example. This was run against tree-sitter-x commit `5c7a2916cdfa93f107833ddaa67688ec16d88a7d`, the one CI uses for the native tests. Other tree-sitter runtimes that load ABI 15 grammars are untested.

The math grammar is `grammar/math/src/parser.c` with `grammar/math/scanner.c`, and its entry point is `tree_sitter_markdown_math`.

## Edit and reparse

Both grammars support incremental parsing through the host's normal edit API. The scanner serializes its state, so an edit reuses unchanged subtrees. The block tree alone does not give you inline links, emphasis, decoded values or reference resolution. Those come from the resolver, which needs the tree-sitter-x host. See [Architecture](../concepts/architecture.md).
