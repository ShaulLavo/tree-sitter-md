# Math

`math: true` turns on `$$` math. It does this by parsing blocks with a second block grammar, `tree-sitter-markdown-chat.wasm`. `math: false` keeps the base grammar and its ordinary lazy paragraph continuations. The choice belongs to each document, and scanner state is not shared between documents.

The second grammar is the base grammar plus `$$` flow math blocks, and nothing else. The word "chat" in the file name, in the `chatGrammar` option of `init()`, and in the `'fregat-chat'` profile label is a historical name: the grammar was built for a chat panel, but nothing in it is specific to chat. Read it as "the math grammar".

`semantics().profile` is `'fregat-chat'` when `gfm` is true and `cjk` or `math` is true. The `cjk` option alone does not change the grammar. It changes emphasis flanking and autolink trimming. See [Supported syntax](syntax.md#options).

### The name `fregat-chat`

`'fregat-chat'` is a label, not a feature switch. It is named after [Fregat](https://github.com/ShaulLavo/fregat), the browser IDE whose chat panel this configuration was built for and which depends on this package. Nothing in the parser reads the string. `semantics()` returns it so a consumer can tell which option combination produced a tree. It does not mean the document came from a chat, and Fregat is not required. The three possible values are `'commonmark'`, `'gfm'` and `'fregat-chat'`. Compare with the exact string. The option combinations are in the table below.

| `gfm` | `cjk` | `math` | `profile` |
| --- | --- | --- | --- |
| `false` | any | any | `'commonmark'` |
| `true` | `false` | `false` | `'gfm'` |
| `true` | `true` | any | `'fregat-chat'` |
| `true` | any | `true` | `'fregat-chat'` |

## Dollar policy

Inline math uses double dollars: `p $$x$$ q`. Single-dollar text such as `$x$` or `Costs $5 today` stays literal. Streamdown [documents this choice to avoid currency conflicts](https://github.com/vercel/streamdown/blob/4c55fad1bb739fba788b1f55bbe878983243edf0/apps/website/content/docs/plugins/math.mdx#currency-vs-math), and its [math plugin](https://github.com/vercel/streamdown/blob/4c55fad1bb739fba788b1f55bbe878983243edf0/packages/streamdown-math/index.ts) defaults `singleDollarTextMath` to false. tree-sitter-md has no option for single-dollar math.

The flow contract follows remark-math 6.0.0, micromark-extension-math 3.1.0 and mdast-util-math 3.0.0 with `singleDollarTextMath: false`. These are behavioral references. None is a dependency.

## Flow blocks

A line-start run of at least two dollars opens flow math when the rest of the opening line contains no dollar. Up to three spaces may precede the run after container prefixes.

- The text after the opening run is `meta`: nullable, with string escapes and entities decoded. Later lines are `value`, which is opaque. `$$tex\nx\n$$` has `meta` `'tex'` and `value` `'x'`. Block nodes always have `meta`. Inline math nodes have only `value`.
- A closing line has at least the opening run's width and only whitespace after it.
- A missing quote or list prefix ends the block before that line. The line is parsed under the container that survives, not kept as lazy math.
- Headings, links, lists and definitions inside the body stay raw math text.

Ranges use original UTF-16 offsets. A full container prefix received at the end of the source belongs to the container and is not part of the math range.

An unfinished block at eligible end of source becomes `pendingMath` in an `'open'` presentation. Leaving a container does not make a block pending. An `'ended'` presentation keeps exact `math`.

The grammar nodes are `math_flow`, `math_flow_delimiter`, `math_flow_meta` and `math_flow_content`. See [Node types](node-types.md#added-by-the-math-grammar). The source of the grammar changes is listed in [Source provenance](provenance.md).
