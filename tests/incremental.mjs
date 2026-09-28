import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, MarkdownDocument } from '../js/index.js';

await init();
const methods = ['decorations', 'highlights', 'folds', 'injections'];
const fixtures=[
 'text **bold** [unknown] and [known]\n\n[known]: /one\n\n[KNOWN]: /two\n\nTail\n',
 '> [ref]\n>\n> [ref]: /one\n\nTail\n',
 '- [ref]\n\n  [ref]: /one\n\nTail\n',
 '| alpha | beta |\n| :--- | ---: |\n| **bold** | [x](y) |\n| a\\|b | `x|y` |\n',
 '> | alpha | beta |\n> | --- | --- |\n> | **bold** | [x](y) |\n',
 '# Hébrew עברית Русский 中文 😀\n\n**a😀é** [ref]\n\n[ref]: /x\n\nzero\0lone\ud800end\udfff\n',
 'a\r\nb\r\n\r\n>  leading\tspaces\r\n>\t**bold**\r\n',
 '```js\nconst a = 1;\n```\n\n[ref]\n\n[ref]: /x\n',
 'plain '.repeat(2048)+'*em* é😀\0\ud800 end\n',
 '> first **bold**\n'+'>   continuation [ref]\n'.repeat(128)+'\n[ref]: /ok\n',
 '| A | B |\n| - | - |\n'+'| plain **bold** | [x](y) |\n'.repeat(256),
 '[missing] [key] **text**\n\n'+Array.from({length:256},(_,i)=>`[ref${i}]: /path/${i}\n\n`).join('')+'[key]: /one\n\n[key]: /two\n',
];

function compare(incremental, fresh, text, context) {
  fresh.setText(text);
  const from = Math.floor(text.length / 3);
  for (const [a, b] of [[0, text.length], [from, Math.min(text.length, from + 500)]]) {
    for (const method of methods) {
      assert.deepEqual(incremental[method](a, b), fresh[method](a, b), `${context}: ${method} ${a}-${b}`);
    }
  }
  assert.equal(incremental.lineCount, fresh.lineCount);
  for (const row of [0, 1, Math.floor(fresh.lineCount / 2), fresh.lineCount]) {
    assert.equal(incremental.rowStart(row), fresh.rowStart(row));
  }
}

function exercise(text, fi, gfm) {
  const incremental = new MarkdownDocument({ gfm });
  const fresh = new MarkdownDocument({ gfm });
  let seed = 4567 + fi;
  try {
    incremental.setText(text);
    compare(incremental, fresh, text, 'initial');
    incremental.reparse();
    for (let i = 0; i < 160; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const at = seed % (text.length + 1), stop = Math.min(text.length, at + (i % 3));
      const ins = ['x', '\n', '>', '[missing]: /now\n\n', '|', '*', '😀', '\ud800', '\0', '\\|', '\t'][i % 11];
      const next = text.slice(0, at) + ins + text.slice(stop);
      incremental.edit(at, stop, ins);
      compare(incremental, fresh, next, `edit ${i}`);
      incremental.edit(at, at + ins.length, text.slice(at, stop));
      compare(incremental, fresh, text, `undo ${i}`);
    }
  } finally {
    incremental.dispose();
    fresh.dispose();
  }
}

for (const gfm of [false, true]) {
  fixtures.forEach((text, fi) => {
    test(`incremental/fresh fixture ${fi}, gfm=${gfm}`, () => exercise(text, fi, gfm));
  });
}

test('comparison detects a deliberately stale document', () => {
  const stale = new MarkdownDocument(), fresh = new MarkdownDocument();
  try {
    stale.setText('[ref]\n');
    assert.throws(() => compare(stale, fresh, '[ref]\n\n[ref]: /target\n', 'negative control'), assert.AssertionError);
  } finally {
    stale.dispose();
    fresh.dispose();
  }
});
