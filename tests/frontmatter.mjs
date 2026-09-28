import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, Kind, MarkdownDocument } from '../js/index.js';

await init();

function kinds(doc, text) {
  return [...doc.decorations(0, text.length)].filter((_, index) => index % 4 === 2);
}

for (const marker of ['---', '+++']) {
  test(`frontmatter is opt-in with ${marker}`, () => {
    const plain = new MarkdownDocument(), extended = new MarkdownDocument({ frontmatter: true });
    const text = `${marker}\ntitle: **metadata**\n${marker}\n\n**body**\n`;
    try {
      plain.setText(text);
      extended.setText(text);
      assert.equal(kinds(plain, text).includes(Kind.Frontmatter), false);
      assert.equal(kinds(extended, text).includes(Kind.Frontmatter), true);
      assert.equal(kinds(extended, text).filter(kind => kind === Kind.Strong).length, 1);
    } finally {
      plain.dispose();
      extended.dispose();
    }
  });
}

test('frontmatter edits and undo agree with a fresh document, including reference visibility', () => {
  const doc = new MarkdownDocument({ frontmatter: true }), fresh = new MarkdownDocument({ frontmatter: true });
  const text = '---\n[ref]: /hidden\n---\n\n[ref]\n\n[ref]: /visible\n';
  try {
    doc.setText(text);
    doc.decorations(0, text.length);
    for (let at = 0; at < text.length; at++) {
      doc.edit(at, at + 1, 'x');
      fresh.setText(text.slice(0, at) + 'x' + text.slice(at + 1));
      for (const method of ['decorations', 'highlights', 'folds', 'injections']) {
        assert.deepEqual(doc[method](0, text.length), fresh[method](0, text.length), `${method} at ${at}`);
      }
      doc.edit(at, at + 1, text[at]);
      fresh.setText(text);
      assert.deepEqual(doc.decorations(0, text.length), fresh.decorations(0, text.length));
    }
  } finally {
    doc.dispose();
    fresh.dispose();
  }
});
