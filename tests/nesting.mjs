import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, Kind, MarkdownDocument } from '../js/index.js';

await init();

for (const depth of [200, 256, 1024]) {
  test(`container nesting is bounded at depth ${depth} without damaging sibling documents`, () => {
    const deep = new MarkdownDocument(), sibling = new MarkdownDocument(), fresh = new MarkdownDocument();
    const text = '> '.repeat(depth) + '**bold**\n';
    try {
      sibling.setText('[ref]\n\n[ref]: /url\n');
      const before = sibling.decorations(0, 100);
      deep.setText(text);
      const records = deep.decorations(0, text.length);
      const quotes = records.filter((kind, index) => index % 4 === 2 && kind === Kind.BlockQuote);
      assert.equal(quotes.length, 200);
      deep.edit(text.length, text.length, '\n# Tail\n');
      fresh.setText(text + '\n# Tail\n');
      for (const method of ['decorations', 'highlights', 'folds', 'injections']) {
        assert.deepEqual(deep[method](0, text.length + 8), fresh[method](0, text.length + 8));
      }
      assert.deepEqual(sibling.decorations(0, 100), before);
      deep.setText('**recovered**\n');
      assert.ok(deep.decorations(0, 14).some((kind, index) => index % 4 === 2 && kind === Kind.Strong));
    } finally {
      deep.dispose();
      sibling.dispose();
      fresh.dispose();
    }
  });
}
