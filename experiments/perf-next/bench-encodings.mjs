import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]);
const {init,MarkdownDocument}=await import(pathToFileURL(root+'/js/index.js'));await init();
const q=(xs,p)=>xs.slice().sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*p))];
const inputs=[['ascii','ordinary text '.repeat(4000)],['hebrew','עברית'.repeat(10000)],['chinese','中文'.repeat(25000)],['emoji','😀'.repeat(25000)]];
for(const[encoding,prefix]of inputs){
 let text=prefix+' the token **end**\n';const at=text.lastIndexOf(' the ')+5;
 const d=new MarkdownDocument();d.setText(text);d.reparse();d.decorations(0,text.length);
 const samples=[];
 for(let i=0;i<150;i++){
  const next=text.slice(0,at)+'x'+text.slice(at);
  const a=performance.now();d.edit(at,at,'x');d.decorations(0,next.length);const ms=performance.now()-a;
  if(i>=50)samples.push(ms);text=next;
 }
 const f=new MarkdownDocument();f.setText(text);assert.deepEqual(d.decorations(0,text.length),f.decorations(0,text.length));f.dispose();d.dispose();
 console.log(JSON.stringify({build:process.env.BUILD_LABEL,round:Number(process.env.ROUND),case:'encoding-'+encoding,warmupEdits:50,measuredEdits:100,median:q(samples,.5),p95:q(samples,.95),samples}));
}
