import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, Kind, MarkdownDocument } from '../js/index.js';

await init();

for (const text of ['[ref]\n\n[ref]: /url\n', '> [ref]\n>\n> [ref]: /url\n\nTail\n']) {
  test(`editing at a definition's end keeps its references: ${JSON.stringify(text)}`, () => {
    const doc = new MarkdownDocument();
    const fresh = new MarkdownDocument();
    const at = text.indexOf('/url') + '/url\n'.length;
    try {
      doc.setText(text);
      doc.decorations(0, text.length);
      doc.edit(at, at, '>');
      const next = text.slice(0, at) + '>' + text.slice(at);
      fresh.setText(next);
      const records = doc.decorations(0, next.length);
      assert.ok(records.some((kind, index) => index % 4 === 2 && kind === Kind.Link));
      for (const method of ['decorations', 'highlights', 'folds', 'injections']) {
        assert.deepEqual(doc[method](0, next.length), fresh[method](0, next.length));
      }
    } finally {
      doc.dispose();
      fresh.dispose();
    }
  });
}
