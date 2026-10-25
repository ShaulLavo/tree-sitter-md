# AGENTS.md

## Commands

- Run Node 24 or later.
- Install both dependency sets first: `bun install --frozen-lockfile && (cd bench && bun install --frozen-lockfile)`. `npm test` reads `bench/node_modules`.
- Run one test file: `node --test tests/<file>`. Run all JavaScript tests: `npm test`.
- Run the correctness gate after any change to `src/`, `vendor/` or `grammar/`: `bun run check` (about 70 seconds).
- Rebuild wasm with `WASI_SDK=<WASI SDK 34 dir> npm run build`, then commit the three `.wasm` files with the source change. The package ships them.
- Regenerate parsers with `npm run generate` (tree-sitter CLI 0.26.9) after editing `grammar/grammar.js`. Never edit `grammar/src/parser.c` or `grammar/math/src/`.
- Run `sh scripts/check-native.sh` on Linux with `TREE_SITTER_LIB` pointing at a tree-sitter-x `lib/`. On macOS it aborts, because ASan has no leak detection there.
- Run `bun run test:types` with `--ignoreConfig` added if a parent directory has a `tsconfig.json`.
- Run `bun run test:package` and `bun run test:browser` for changes to `js/` or `package.json`. They need Playwright Chromium.

## Verify a change

- Grammar or scanner: run `npm test` and `bun run check`. Test both profiles (base and `math: true`), because `grammar/math/scanner.c` includes `grammar/src/scanner.c`.
- Incremental behavior: compare an edit-then-undo result with a fresh parse. `bench/fuzz.mjs` does this in `bun run check`.
- Public output shape: update `js/*.d.ts` and `tests/types/presentation.ts` together.

## Gotchas

- Offsets are UTF-16 code units everywhere in the JavaScript API.
- The scanner calls cmark to validate reference definitions. Native hosts compile `vendor/cmark/*.c` with the grammar.
- Take expected values in new tests from cmark, cmark-gfm or micromark, never from this parser's output. Fixtures keep original UTF-16 source hashes.
- `bench/docs/` and `bench/spec/` are benchmark inputs. Do not edit them.
- `bench/chromium.mjs` needs `PLAYWRIGHT=<path to playwright/index.js>`.
- The resolver loads only into the tree-sitter-x build pinned in `package.json`. Stock `web-tree-sitter` fails on a missing `heap` export.
- `.changeset/` has no config and no tool reads it.
- Each fix PR bumps the patch version in `package.json` and adds an entry to `CHANGELOG.md`.

## Docs

- Read `docs/concepts/architecture.md` and `docs/adr/` before you change the grammar tokenization or the resolver boundary.
- Update `docs/reference/` in the same change when you alter an option, record layout, node type or snapshot field. The reference mirrors `js/` and `grammar/src/node-types.json`.
- Re-run the commands in `docs/reference/performance.md` before you change a number in it.
- Keep plans, audits and measurement dumps in `.internal/`. `docs/` and `README.md` never link there.
