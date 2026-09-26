import {readFileSync,writeFileSync} from 'node:fs';
const directory=process.argv[2];
const med=values=>values.toSorted((a,b)=>a-b)[values.length>>1];
const result={};
for(const build of ['rust','c']) {
  const rows=[1,2,3].flatMap(i=>readFileSync(`${directory}/${build}-${i}.jsonl`,'utf8').trim().split('\n').map(JSON.parse));
  result[build]={};
  for(const file of ['agents.md','big.md']) {
    const data=rows.filter(r=>r.file===file && !r.noIdleReparse);
    const raw=rows.filter(r=>r.file===file && r.noIdleReparse);
    result[build][file]={runs:data.length};
    for(const key of ['firstFrame','fullParse','decorateWholeDocument','firstKeystroke']) result[build][file][key]=med(data.map(r=>r[key]));
    result[build][file].firstKeystrokeWithoutIdle=med(raw.map(r=>r.firstKeystroke));
    for(const key of ['totalMedian','totalP95']) result[build][file][key]=med(data.map(r=>r.keystroke[key]));
  }
}
const gates=['agents.md','big.md'].map(file=>({file,median:result.c[file].totalMedian<=result.rust[file].totalMedian,p95:result.c[file].totalP95<=result.rust[file].totalP95}));
console.log(JSON.stringify({result,gates},null,2));
if(process.argv[3]) writeFileSync(process.argv[3],JSON.stringify({result,gates},null,2)+'\n');
if(gates.some(g=>!g.median||!g.p95)) process.exitCode=1;
