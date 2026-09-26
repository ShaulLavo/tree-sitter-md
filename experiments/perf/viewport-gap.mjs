import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] ?? '.');
const { init, MarkdownDocument } = await import(pathToFileURL(root + '/js/index.js'));
await init(process.env.WASM ? readFileSync(process.env.WASM) : undefined);
let failures = 0;
for (const gfm of [false, true]) {
  const doc = new MarkdownDocument({ gfm });
  try {
    doc.setText('a\n\nb');
    const actual = Array.from(doc.decorations(2, 4));
    const expected = [3, 4, 1, 0];
    console.log(JSON.stringify({ gfm, text: 'a\n\nb', from: 2, to: 4, actual, expected }));
    try { assert.deepEqual(actual, expected); } catch { failures++; }
  } finally { doc.dispose(); }
}
assert.equal(failures, 0, 'A viewport beginning on the blank line must include the following paragraph');
