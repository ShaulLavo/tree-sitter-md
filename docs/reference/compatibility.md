# Compatibility and limits

What runs where, which host runtime it needs, and the hard limits. "Tested" means a command in this repository ran it, either in CI (`.github/workflows/check.yml`) or when this page was written.

## Runtimes

| Environment | Status | Evidence |
| --- | --- | --- |
| Node 26 and later | Supported. `package.json` sets `engines.node` to `>=26`. | CI uses Node 26. `npm test` passed 2,906 tests on 26.12.1. |
| Node 24 | Fails at `init()` with `exports.memory.toResizableBuffer is not a function`. | Run on 24.22.1. |
| Bun 1.4.4 | Supported. | CI pins 1.4.4. `bun run test:package` runs the packed package under Bun in all three initialization orders. |
| Chromium | Supported through a Vite production build. | `bun run test:package` and `bun run test:browser` pass on Chromium 153. CI runs both. |
| Firefox, WebKit | Not tested. `bun run test:browser` accepts `chromium firefox webkit`, but CI installs only Chromium. | |
| Deno, Cloudflare Workers, other hosts | Not tested. | |

The wasm modules are platform independent. Tested operating systems are macOS on Apple silicon (this page) and Ubuntu 24.04 on x86-64 (CI).

## Host runtime

`package.json` declares the peer dependency `web-tree-sitter` `^0.28.1`. **No version in that range exists on npm.** The latest `web-tree-sitter` on npm is 0.27.1, so `npm install web-tree-sitter` cannot satisfy the peer range. The range is met only by the [tree-sitter-x](https://github.com/ShaulLavo/tree-sitter-x) build, which installs from Git as `web-tree-sitter` and reports version 0.28.4. npm does not warn when you install tree-sitter-md next to stock 0.27.1 (npm 11.19.1), and `init()` then fails on import.

tree-sitter-md needs tree-sitter-x because it needs the `heap` and `loadExtension` exports. They let the resolver share the host's WebAssembly memory and tree-sitter C API. tree-sitter-x is a fork of the tree-sitter web runtime that adds them. Stock `web-tree-sitter` has neither.

The working install command, which the README quick start uses:

```sh
npm install github:ShaulLavo/tree-sitter-md#main web-tree-sitter@github:ShaulLavo/tree-sitter-x#aab7db1518c19f61c1b13ec3f832b881cf5f1385
```

| | |
| --- | --- |
| Peer dependency | `web-tree-sitter` `^0.28.1`. Not published on npm. |
| Pinned build | `github:ShaulLavo/tree-sitter-x#aab7db1518c19f61c1b13ec3f832b881cf5f1385`, version 0.28.4 (development and packed-consumer tests). |
| Stock `web-tree-sitter` 0.26.9 and 0.27.1 (latest on npm) | Fail on import: `The requested module 'web-tree-sitter' does not provide an export named 'heap'`. |
| Language ABI | 15 (`TREE_SITTER_LANGUAGE_VERSION`) |

The block grammar alone does not need tree-sitter-x. See [How to use the block grammar in another tree-sitter host](../guides/use-the-grammar-alone.md).

When another dependency pulls stock `web-tree-sitter`, force one build with an `overrides` entry in the root `package.json`:

```json
{
	"dependencies": {
		"tree-sitter-md": "github:ShaulLavo/tree-sitter-md#main",
		"web-tree-sitter": "github:ShaulLavo/tree-sitter-x#aab7db1518c19f61c1b13ec3f832b881cf5f1385"
	},
	"overrides": {
		"web-tree-sitter": "github:ShaulLavo/tree-sitter-x#aab7db1518c19f61c1b13ec3f832b881cf5f1385"
	}
}
```

Compatible tree-sitter-x builds in the `0.28` line can replace the pin. The tests keep an exact known-good commit.

## Bundlers

The default `.wasm` URLs resolve from `import.meta.url`. Bundlers that move the files (Vite's dependency pre-bundling) need explicit URLs. See [Troubleshooting](../troubleshooting.md#the-wasm-files-return-404-in-vite). A Vite production build of the packed package fetched four `.wasm` files in Chromium: the three from this package and the host runtime's.

## Limits

| Limit | Value | Behavior past the limit |
| --- | --- | --- |
| Open containers (quotes and list items) | 200 | Further `>` and list markers are source text. |
| Reference label length | 999 characters | The label is not a reference, as in CommonMark. |
| Offsets | UTF-16 code units | Not code points or bytes. |
| Memory | Grows, never shrinks | `dispose()` makes allocations reusable. |
| Calls | Synchronous, on the calling thread | Read costs are in [Performance](performance.md). |
| Raw HTML | Kept as data | The consumer sanitizes it. |

## Stability

Pre-1.0. The package is at 0.1.32. The `semantics()` and `presentation()` types gained fields between 0.1.x releases (see the [changelog](../../CHANGELOG.md)), and the project makes no compatibility promise across them. npm has only 0.1.0 and 0.1.1 (2026-09-28). 0.1.1 has the record methods (`decorations`, `highlights`, `folds`, `injections`) and no `semantics()`, `presentation()`, CHAT grammar, or `cjk` and `math` options. Install from Git.
