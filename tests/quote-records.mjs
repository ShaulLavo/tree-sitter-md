import assert from 'node:assert/strict';
import {test} from 'node:test';
import {init, MarkdownDocument, Kind} from '../js/index.js';
await init();
for(const text of ['> **one\n> two**\n','> ```js\n> x\n> ```\n','> | a |\n> | - |\n> | b |\n','>> one\n>> two\n']) {
  test(`quote markers on every continuation ${JSON.stringify(text)}`,()=>{
    const doc=new MarkdownDocument();
    try {
      doc.setText(text);
      const records=doc.decorations(0,text.length),marks=[];
      for(let i=0;i<records.length;i+=4) if(records[i+2]===Kind.QuoteMark) marks.push(records[i]);
      assert.deepEqual(marks.sort((a,b)=>a-b),Array.from(text.matchAll(/>/g),match=>match.index));
    } finally {doc.dispose();}
  });
}
