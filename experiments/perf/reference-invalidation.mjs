import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]??'.');
const {init,MarkdownDocument}=await import(pathToFileURL(root+'/js/index.js'));
await init(process.env.WASM ? readFileSync(process.env.WASM) : undefined);
const before='[ref]\n>[ref]:o',after='[ref]\n\n[ref]:o';
let failures=0;
for(const gfm of [false,true]){
  const incremental=new MarkdownDocument({gfm}),fresh=new MarkdownDocument({gfm});
  try{
    incremental.setText(before);incremental.decorations(0,before.length);
    incremental.edit(6,7,'\n');fresh.setText(after);
    const actual=incremental.decorations(0,after.length),expected=fresh.decorations(0,after.length);
    console.log(JSON.stringify({gfm,actual:Array.from(actual),expected:Array.from(expected)}));
    try{assert.deepEqual(actual,expected);}catch{failures++;}
  }finally{incremental.dispose();fresh.dispose();}
}
assert.equal(failures,0,'Replacing the quote marker with a newline must retain reference-link resolution');
