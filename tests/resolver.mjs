import {test} from 'node:test';
import assert from 'node:assert/strict';
import {init,MarkdownDocument,Kind} from '../js/index.js';
await init();
function records(doc,text,kind) {
  const data=doc.decorations(0,text.length), out=[];
  for(let i=0;i<data.length;i+=4) if(data[i+2]===kind) out.push(text.slice(data[i],data[i+1]));
  return out;
}
test('unmatched long backticks preserve later short closers',()=>{
  const doc=new MarkdownDocument();
  const text='``` unmatched, `one`, `` `two` ``, and `three`';
  doc.setText(text);
  // The leading run is a fence at block start; put it inside a paragraph.
  const paragraph='text '+text;
  doc.setText(paragraph);
  assert.deepEqual(records(doc,paragraph,Kind.CodeSpan),['`one`','`` `two` ``','`three`']);
  doc.dispose();
});
test('reference edits invalidate successful and unsuccessful lookups, first definition wins',()=>{
  let text='😀 [Straße] [new]\n\n[STRASSE]: /first\n\n[STRASSE]: /second\n';
  const doc=new MarkdownDocument();doc.setText(text);
  assert.equal(records(doc,text,Kind.Link).length,1);
  const a=text.indexOf('[STRASSE]: /first'), b=a+'[STRASSE]: /first'.length;
  doc.edit(a,b,'[new]: /third');text=text.slice(0,a)+'[new]: /third'+text.slice(b);
  assert.equal(records(doc,text,Kind.Link).length,2);
  const fresh=new MarkdownDocument();fresh.setText(text);
  for(const method of ['decorations','highlights','folds','injections'])
    assert.deepEqual(doc[method](0,text.length),fresh[method](0,text.length));
  fresh.dispose();doc.dispose();
});
test('continuation layout and UTF-16 offsets survive edits',()=>{
  let text='> 😀 **bold\n> across** and [label](url)\n\n```js\nlet x = 1\n```\n';
  const doc=new MarkdownDocument();doc.setText(text);
  assert.deepEqual(records(doc,text,Kind.Strong),['**bold\n> across**']);
  for(const [a,b,insert] of [[0,0,'# title\n\n'],[20,21,'\n> '],[0,9,'']]) {
    doc.edit(a,b,insert);text=text.slice(0,a)+insert+text.slice(b);
    const fresh=new MarkdownDocument();fresh.setText(text);
    for(const method of ['decorations','highlights','folds','injections'])
      assert.deepEqual(doc[method](0,text.length),fresh[method](0,text.length));
    fresh.dispose();
  }
  doc.dispose();
});
test('GFM option controls single and double tilde strikethrough and literal autolinks',()=>{
  const text='~one~ ~~two~~ www.example.org';
  for(const gfm of [false,true]) {
    const doc=new MarkdownDocument({gfm});doc.setText(text);
    assert.equal(records(doc,text,Kind.Strikethrough).length,gfm?2:0);
    assert.equal(records(doc,text,Kind.Link).length,gfm?1:0);
    doc.dispose();
  }
});

test('GFM email protocols include the prefix and XMPP resource',()=>{
  const doc=new MarkdownDocument();
  const text='mailto:one@example.org xmpp:two@example.org/resource patches/pkg@0.4.0.patch';
  doc.setText(text);
  assert.deepEqual(records(doc,text,Kind.Link),['mailto:one@example.org','xmpp:two@example.org/resource']);
  doc.dispose();
});

test('the standalone wasm needs no host imports',async()=>{
  const {readFile}=await import('node:fs/promises');
  const bytes=await readFile(new URL('../tree-sitter-md.wasm',import.meta.url));
  const module=await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
});
