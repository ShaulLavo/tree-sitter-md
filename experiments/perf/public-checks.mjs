import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]),out=resolve(process.argv[3]);mkdirSync(out,{recursive:true});
const checks=[];
function check(name,fn){try{const result=fn();checks.push({name,status:'pass',result});}catch(error){checks.push({name,status:'fail',error:String(error)});}}
function run(name,args,env={}){try{const text=execFileSync(process.execPath,args,{cwd:root,encoding:'utf8',env:Object.assign({},process.env,env),maxBuffer:32<<20});writeFileSync(out+'/'+name+'.txt',text);return text;}catch(e){writeFileSync(out+'/'+name+'.txt',String(e.stdout??'')+String(e.stderr??''));throw e;}}
check('spec floor',()=>{run('spec',['bench/spec.mjs']);const rows=JSON.parse(readFileSync(root+'/bench/out/spec-results.json'));const counts={};for(const row of rows)counts[row.section]=(counts[row.section]??0)+Number(row.v['tree-sitter-md'].pass);const floors=JSON.parse(readFileSync(root+'/tests/spec-floor.json'));for(const [section,floor]of Object.entries(floors))assert(counts[section]>=floor,section);const total=Object.values(counts).reduce((a,b)=>a+b,0);assert(total>=672);writeFileSync(out+'/spec-results.json',JSON.stringify(rows));return{total,examples:rows.length,counts};});
for(const seed of [1,7,8675309])for(const [file,edits]of [['agents.md',11000],['big.md',300]])check('fuzz '+file+' seed '+seed,()=>{const text=run('fuzz-'+file+'-'+seed,['bench/fuzz.mjs','bench/docs/'+file,String(edits),String(seed)]);const result=JSON.parse(text.trim().split('\n').at(-1));assert.equal(result.edits,edits);assert.equal(result.failures,0);return result;});
check('negative control',()=>{const text=run('negative-control',['bench/fuzz.mjs','bench/docs/agents.md','100','1'],{CONTROL:'1'});const result=JSON.parse(text.trim().split('\n').at(-1));assert(result.checks>0);assert.equal(result.failures,result.checks);return result;});
writeFileSync(out+'/public-checks.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));if(checks.some(c=>c.status!=='pass'))process.exitCode=1;
