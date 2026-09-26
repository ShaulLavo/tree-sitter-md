import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]);
const {init,MarkdownDocument}=await import(pathToFileURL(root+'/js/index.js'));await init();
const q=(xs,f)=>xs.slice().sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*f))];
const nth=(t,a,n)=>{for(let i=0;i<n;i++){a=t.indexOf('\n',a+1);if(a<0)return t.length;}return a;};
const refs=n=>'Some prose with the token and **bold** [r42].\n\n'.repeat(60)+Array.from({length:n},(_,i)=>`[r${i}]: /path/${i}\n\n`).join('');
const cases=[
 ['refs-500',refs(500),2400],['refs-2000',refs(2000),2400],
 ['table-1000','| A | B |\n| - | - |\n'+Array.from({length:1000},(_,i)=>`| the token **${i}** | [x](y) |\n`).join('')],
 ['continuations-1000','> the token **bold**\n'+'> continuation with the token *em*\n'.repeat(1000)+'\n'],
 ['ascii-paragraph-64k','plain text with the token '.repeat(2600)+' **end**\n'],
 ['unicode-paragraph','עברית 😀 café with the token '.repeat(2000)+' **end**\n'],
];
for(const[name,original,limit]of cases){
 for(let w=0;w<3;w++){const d=new MarkdownDocument();d.setText(original);d.decorations(0,original.length);d.reparse();d.dispose();}
 let text=original;const d=new MarkdownDocument();d.setText(text);d.decorations(0,text.length);d.reparse();
 let seed=11;const edit=[],deco=[],total=[];
 for(let i=0;i<100;i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  let found=text.indexOf(' the ',Math.floor((limit??text.length)*(seed/4294967296)));
  if(found<0)found=text.indexOf(' the ');assert(found>=0);
  // Insert after the anchor so repeated typing cannot exhaust the fixture.
  const at=found+5;
  const next=text.slice(0,at)+'x'+text.slice(at);
  const from=next.lastIndexOf('\n',Math.max(0,at-1000))+1,to=nth(next,from,60);
  const a=performance.now();d.edit(at,at,'x');const b=performance.now();d.decorations(from,to);const c=performance.now();
  edit.push(b-a);deco.push(c-b);total.push(c-a);text=next;
 }
 const f=new MarkdownDocument();f.setText(text);assert.deepEqual(d.decorations(0,text.length),f.decorations(0,text.length));f.dispose();d.dispose();
 console.log(JSON.stringify({build:process.env.BUILD_LABEL,round:Number(process.env.ROUND),case:name,chars:original.length,edits:total.length,median:q(total.slice(5),.5),p95:q(total.slice(5),.95),editMedian:q(edit.slice(5),.5),decorateMedian:q(deco.slice(5),.5),samples:total}));
}
// Full decoration is separately timed, with parsing deliberately outside the timer.
for(const file of ['agents.md','big.md']){
 const text=readFileSync(root+'/bench/docs/'+file,'utf8'),times=[];
 for(let i=0;i<12;i++){
  const d=new MarkdownDocument();d.setText(text);const a=performance.now();d.decorations(0,text.length);times.push(performance.now()-a);d.dispose();
 }
 console.log(JSON.stringify({build:process.env.BUILD_LABEL,round:Number(process.env.ROUND),case:'decorate-'+file,median:q(times.slice(2),.5),p95:q(times.slice(2),.95),samples:times}));
}
