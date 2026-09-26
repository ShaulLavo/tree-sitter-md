import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const run=(file,args=[],env=process.env)=>execFileSync(process.execPath,[`bench/${file}.mjs`,...args],{encoding:'utf8',env,maxBuffer:16<<20});
const last=text=>JSON.parse(text.trim().split('\n').at(-1));
assert(process.env.CHAT,'CHAT must point to the private 183-message JSON corpus');
console.log(run('spec'));
const counts={};
for(const row of json('bench/out/spec-results.json')) counts[row.section]=(counts[row.section]??0)+Number(row.v['tree-sitter-md'].pass);
for(const [section,floor] of Object.entries(json('tests/spec-floor.json'))) assert(counts[section]>=floor,section);
assert(Object.values(counts).reduce((a,b)=>a+b,0)>=672);
console.log(run('corpus'));
const corpus=json('bench/out/corpus-stats.json');
assert.equal(corpus['chat:tree-sitter-md'].docs,183);assert.equal(corpus['chat:tree-sitter-md'].pass,183);
console.log(execFileSync(process.execPath,['scripts/check-repository.mjs'],{encoding:'utf8',maxBuffer:16<<20}));
for(const [file,edits] of [['agents.md',11000],['big.md',300]]) {
  const result=last(run('fuzz',[`bench/docs/${file}`,String(edits),'1']));
  assert.equal(result.failures,0);assert.equal(result.edits,edits);console.log(result);
}
const control=last(run('fuzz',['bench/docs/agents.md','100','1'],{...process.env,CONTROL:'1'}));
assert.equal(control.failures,control.checks);assert(control.failures>0);console.log({control});
