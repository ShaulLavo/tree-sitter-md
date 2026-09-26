import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]);
const {init,MarkdownDocument}=await import(pathToFileURL(root+'/js/index.js'));await init();
const q=(xs,p)=>xs.slice().sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*p))];
for(const file of ['agents.md','big.md']){
 let text=readFileSync(root+'/bench/docs/'+file,'utf8');
 const d=new MarkdownDocument();d.setText(text);d.reparse();d.decorations(0,text.length);
 let seed=11;const total=[],edit=[],decorate=[];
 for(let i=0;i<1200;i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  let found=text.indexOf(' the ',Math.floor(text.length*(seed/4294967296)));if(found<0)found=text.indexOf(' the ');assert(found>=0);
  const at=found+5,next=text.slice(0,at)+'x'+text.slice(at);
  const from=next.lastIndexOf('\n',Math.max(0,at-1000))+1;
  let to=from;for(let j=0;j<60;j++){to=next.indexOf('\n',to+1);if(to<0){to=next.length;break;}}
  const a=performance.now();d.edit(at,at,'x');const b=performance.now();d.decorations(from,to);const c=performance.now();
  if(i>=800){edit.push(b-a);decorate.push(c-b);total.push(c-a);}text=next;
 }
 const f=new MarkdownDocument();f.setText(text);assert.deepEqual(d.decorations(0,text.length),f.decorations(0,text.length));f.dispose();d.dispose();
 console.log(JSON.stringify({build:process.env.BUILD_LABEL,round:Number(process.env.ROUND),case:'warm-'+file,warmupEdits:800,measuredEdits:400,median:q(total,.5),p95:q(total,.95),editMedian:q(edit,.5),decorateMedian:q(decorate,.5),samples:total}));
}
