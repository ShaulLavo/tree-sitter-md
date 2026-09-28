import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fromMarkdown} from '../bench/node_modules/mdast-util-from-markdown/index.js';
import {fromMdast, fromTsmd, compare} from '../bench/constructs.mjs';
import {init, MarkdownDocument, Kind} from '../js/index.js';

await init();
const methods = ['decorations', 'highlights', 'folds', 'injections'];
function verify(text) {
  const doc = new MarkdownDocument({gfm:false});
  const fresh = new MarkdownDocument({gfm:false});
  try {
    doc.setText(text);
    const difference = compare(fromMdast(text, fromMarkdown(text)), fromTsmd(text, doc.decorations(0,text.length)));
    assert.deepEqual(difference, {pass:true, missing:[], extra:[]}, JSON.stringify(text));
    for (const at of [0, text.indexOf('\n') + 1, Math.floor(text.length / 2), text.length]) {
      doc.edit(at, at, 'x');
      fresh.setText(text.slice(0,at) + 'x' + text.slice(at));
      for (const method of methods)
        assert.deepEqual(doc[method](at,text.length+1), fresh[method](at,text.length+1), `${method} edit ${at}`);
      doc.edit(at, at+1, '');
      fresh.setText(text);
      for (const method of methods)
        assert.deepEqual(doc[method](at,text.length), fresh[method](at,text.length), `${method} undo ${at}`);
    }
  } finally {
    doc.dispose();
    fresh.dispose();
  }
}

for (const underline of ['=', '===', '-', '--', '---']) {
  for (const body of ['', 'title\n', '[other]: /other\n', '[other]: /other\ntitle\n']) {
    for (const prefix of ['', '> ', '- ']) {
      const lines = `[ref]: /url\n${body}${underline}\n[ref]\n`.split('\n');
      const text = lines.map((line,i) => line ? `${prefix === '- ' && i ? '  ' : prefix}${line}` : '').join('\n');
      test(`definitions and setext ${JSON.stringify([underline,body,prefix])}`, () => verify(text));
    }
  }
}

for (const text of [
  '>>- one\n>>\n  >  > two\n',
  '> - one\n>\n> two\n',
  '> - one\n>\n>\n> two\n',
  '- one\n\n  > two\n  >\n\nthree\n',
  '- Foo\n\n      bar\n\n\n      baz\n',
  '> 1. > Blockquote\n> continued here.\n',
  '* a\n  > b\n  >\n* c\n',
  '[ref]: /url\n"multi\nline title"\n===\n[ref]\n',
  '> [ref]: /url\n> "multi\n> line title"\n> ===\n> [ref]\n',
  '[ref]: /url "title\n# heading\nend"\n===\n[ref]\n',
  '[ref]: /url "title\n---\nend"\n===\n[ref]\n',
  '[ref]: /url "title\n\nend"\n===\n[ref]\n',
  '[ref]: /url\n"unfinished\n===\n[ref]\n',
  '[ref]: /url\n===\ntext\n---\n',
  '[ref]: /url\n===\n\ntext\n',
  '[ref]: /url\n===\n- item\n',
  '[ref]: /url\n===\n# heading\n',
  '[ref\n# heading]: /url\n===\n[ref]\n',
  '[ref]: /url\n\n2. item\n',
  '[ref]: /url\n2. item\n',
  '[ref]: /url\n    content\n',
  '[ref]: /url\n# heading\n2. item\n',
]) test(`block boundaries ${JSON.stringify(text)}`, () => verify(text));

test('definition extent shrinks past the edit after undo', () => {
  const text = '- [ref]\n\n  [ref]: /one\n\nTail\n';
  const doc = new MarkdownDocument();
  try {
    doc.setText(text);
    const expected = doc.decorations(0,text.length);
    doc.edit(23,25,'\t');
    doc.decorations(0,text.length-1);
    doc.edit(23,24,'\nT');
    assert.deepEqual(doc.decorations(0,text.length),expected);
  } finally { doc.dispose(); }
});

test('definition records are not heading marks', () => {
  const text = '[ref]: /url\nheading\n===\n';
  const doc = new MarkdownDocument();
  try {
    doc.setText(text);
    const records = doc.decorations(0,text.length), marks=[];
    for(let i=0;i<records.length;i+=4)
      if(records[i+2]===Kind.HeadingMark) marks.push(text.slice(records[i],records[i+1]));
    assert.deepEqual(marks,['===']);
  } finally { doc.dispose(); }
});

for (const delimiter of ['```', '~~~']) {
  for (const newline of ['', '\n', '\r\n']) {
    test(`closing fence at EOF ${JSON.stringify([delimiter,newline])}`, () => {
      const text = `${delimiter}js\nconst a = 1\n${delimiter}${newline}`;
      const doc = new MarkdownDocument();
      try {
        doc.setText(text);
        const records = doc.decorations(0,text.length), marks=[];
        for(let i=0;i<records.length;i+=4)
          if(records[i+2]===Kind.FenceMark) marks.push(text.slice(records[i],records[i+1]));
        assert.deepEqual(marks,[delimiter,delimiter]);
        const injection = doc.injections(0,text.length);
        assert.equal(injection.length,4);
        assert.equal(text.slice(injection[0],injection[1]),'const a = 1\n');
      } finally { doc.dispose(); }
    });
  }
}

test('long multiline definition titles preserve their complete range', () => {
  const definition = '[ref]: /url "title\n' + 'continuation\n'.repeat(20000) + 'end"';
  const text = definition + '\n===\n[ref]\n';
  const doc = new MarkdownDocument();
  try {
    doc.setText(text);
    const data = doc.decorations(0,text.length);
    assert.ok(Array.from({length:data.length/4},(_,i) => data.slice(i*4,i*4+4))
      .some(r => r[2]===Kind.Definition && r[0]===0 && r[1]===definition.length));
  } finally { doc.dispose(); }
});
