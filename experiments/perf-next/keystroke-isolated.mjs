import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=resolve(process.argv[2] ?? '.');
const {init,MarkdownDocument}=await import(pathToFileURL(root+'/js/index.js'));
await init(readFileSync(process.argv[3] ?? root+'/tree-sitter-md.wasm'));
const quantile=(xs,q)=>xs.slice().sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*q))];
const nthNewline=(text,from,n)=>{let at=from;for(let i=0;i<n;i++){at=text.indexOf('\n',at+1);if(at<0)return text.length;}return at;};
const cases=[['agents.md',readFileSync(root+'/bench/docs/agents.md','utf8')],['big.md',readFileSync(root+'/bench/docs/big.md','utf8')],['nested-quotes',Array.from({length:160},(_,i)=>'> '.repeat([1,4,8,16,32][i%5])+'Some prose with the token and **bold** text.\n\n').join('')]];
for(const [name,original] of cases){
  for(let i=0;i<3;i++){const d=new MarkdownDocument();d.setText(original);d.reparse();d.decorations(0,Math.min(original.length,20000));d.dispose();}
  const doc=new MarkdownDocument();let text=original;doc.setText(text);doc.reparse();
  let seed=11;const edit=[],decorate=[],total=[];
  for(let i=0;i<200;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const at=text.indexOf(' the ',Math.floor(text.length*(seed/4294967296)))+1;
    if(at<1)continue;
    const next=text.slice(0,at)+'x'+text.slice(at);
    const from=next.lastIndexOf('\n',Math.max(0,at-2000))+1,to=nthNewline(next,from,60);
    const a=performance.now();doc.edit(at,at,'x');const b=performance.now();doc.decorations(from,to);const c=performance.now();
    text=next;edit.push(b-a);decorate.push(c-b);total.push(c-a);
  }
  const fresh=new MarkdownDocument();fresh.setText(text);assert.deepEqual(doc.decorations(0,text.length),fresh.decorations(0,text.length));fresh.dispose();doc.dispose();
  const warm=total.slice(1);assert(warm.length>100);
  console.log(JSON.stringify({build:process.env.BUILD_LABEL??'unspecified',round:Number(process.env.ROUND??0),case:name,chars:original.length,edits:total.length,editMedian:quantile(edit.slice(1),.5),decorateMedian:quantile(decorate.slice(1),.5),median:quantile(warm,.5),p95:quantile(warm,.95),first:total[0],samples:total}));
}
