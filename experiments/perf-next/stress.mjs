import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const paths=process.argv.slice(2).map(p=>resolve(p));
assert.equal(paths.length,2,'baseline and candidate paths required');
const [base,candidate]=await Promise.all(paths.map(p=>import(pathToFileURL(p+'/js/index.js'))));
await base.init();await candidate.init();
const methods=['decorations','highlights','folds','injections'];
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
let comparisons=0,edits=0;
const baselineDivergences=[];
function check(a,b,f,g,text,tag){
 f.setText(text);g.setText(text);
 const n=text.length;
 for(const [from,to]of [[0,n],[Math.floor(n/3),Math.min(n,Math.floor(n/3)+500)]]){
  for(const method of methods){
   const av=a[method](from,to),bv=b[method](from,to),fv=f[method](from,to),gv=g[method](from,to);
   assert.deepEqual(bv,av,tag+' incremental cross-build '+method);comparisons++;
   assert.deepEqual(fv,gv,tag+' fresh cross-build '+method);comparisons++;
   // Preserve and report pre-existing failures, never label these as fresh-parse
   // successes. The performance candidate must introduce no changed outcome.
   const baselineFresh=isDeepStrictEqual(av,gv),candidateFresh=isDeepStrictEqual(bv,fv);
   assert.equal(candidateFresh,baselineFresh,tag+' changed incremental/fresh status '+method);comparisons++;
   if(!baselineFresh)baselineDivergences.push({tag,from,to,method});
  }
 }
 assert.equal(a.lineCount,b.lineCount);assert.equal(b.lineCount,f.lineCount);comparisons+=2;
 for(const row of [0,1,Math.floor(b.lineCount/2),b.lineCount]){assert.equal(a.rowStart(row),b.rowStart(row));assert.equal(b.rowStart(row),f.rowStart(row));comparisons+=2;}
}
for(const gfm of [false,true])for(let fi=0;fi<fixtures.length;fi++){
 const a=new base.MarkdownDocument({gfm}),b=new candidate.MarkdownDocument({gfm}),f=new candidate.MarkdownDocument({gfm}),g=new base.MarkdownDocument({gfm});
 let text=fixtures[fi],seed=4567+fi;
 try{
  a.setText(text);b.setText(text);check(a,b,f,g,text,`initial ${fi}/${gfm}`);a.reparse();b.reparse();
  // Mutations and their inverse exercise source removal/reinsertion, Unicode
  // boundaries, container layout, dirty reference maps and leaf-cache reuse.
  for(let i=0;i<160;i++){
   seed=(Math.imul(seed,1664525)+1013904223)>>>0;
   const at=seed%(text.length+1),stop=Math.min(text.length,at+(i%3));
   const old=text.slice(at,stop),ins=['x','\n','>','[missing]: /now\n\n','|','*','😀','\ud800','\0','\\|','\t'][i%11];
   const before=text,next=text.slice(0,at)+ins+text.slice(stop);
   a.edit(at,stop,ins);b.edit(at,stop,ins);edits++;text=next;
   check(a,b,f,g,text,`${fi}/${gfm}/${i}`);
   a.edit(at,at+ins.length,old);b.edit(at,at+ins.length,old);edits++;text=before;
   check(a,b,f,g,text,`undo ${fi}/${gfm}/${i}`);
  }
 }finally{a.dispose();b.dispose();f.dispose();g.dispose();}
}
console.log(JSON.stringify({fixtures:fixtures.length,gfmModes:2,edits,comparisons,newRegressions:0,baselineFreshDivergences:baselineDivergences.length,baselineDivergences}));
