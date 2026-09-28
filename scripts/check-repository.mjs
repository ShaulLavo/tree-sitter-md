import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {init,MarkdownDocument} from '../js/index.js';

const repos=[['platform',process.env.PLATFORM??'/work/projects/platform','c130dd35a'],['editor',process.env.EDITOR_REPO??'/work/projects/Editor','74e76be']];
export function checkDifferences(actual,allowed) {
  assert.equal(actual.sha256,allowed.sha256,`${actual.name}: corpus input changed`);
  for(const key of ['missing','extra']) {
    const remaining=[...allowed[key]];
    for(const entry of actual[key]) {
      const at=remaining.indexOf(entry);
      assert(at!==-1,`${actual.name}: unexpected ${key} ${entry}`);
      remaining.splice(at,1);
    }
  }
}
export async function repositoryDifferences(wasm) {
  const [{fromMarkdown},{gfm},{gfmFromMarkdown},{fromMdast,fromTsmd,compare}]=await Promise.all([
    import('../bench/node_modules/mdast-util-from-markdown/index.js'),
    import('../bench/node_modules/micromark-extension-gfm/index.js'),
    import('../bench/node_modules/mdast-util-gfm/index.js'),
    import('../bench/constructs.mjs'),
  ]);
  await init(wasm && {inline: wasm});
  const doc=new MarkdownDocument(), results=[];
  const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:1<<26});
  for(const [repo,root,rev] of repos) {
    const files=git(root,'ls-tree','-r','--name-only',rev).trim().split('\n').filter(f=>f.endsWith('.md'));
    for(const file of files) {
      const text=git(root,'show',`${rev}:${file}`);
      const expected=fromMdast(text,fromMarkdown(text,{extensions:[gfm()],mdastExtensions:[gfmFromMarkdown()]}));
      doc.setText(text);
      const actual=fromTsmd(text,doc.decorations(0,text.length));
      const {missing,extra}=compare(expected,actual,{ignore:new Set(['tight','math','imath'])});
      results.push({name:`${repo}/${file}`,sha256:createHash('sha256').update(text).digest('hex'),missing,extra});
    }
  }
  doc.dispose();
  return results;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const allowed=JSON.parse(readFileSync(new URL('../tests/repository-differences.json',import.meta.url),'utf8'));
  const actual=await repositoryDifferences();
  assert.deepEqual(actual.map(d=>d.name),allowed.documents.map(d=>d.name));
  for(let i=0;i<actual.length;i++) checkDifferences(actual[i],allowed.documents[i]);
  console.log(`Repository gate: ${actual.length} pinned documents, no unexpected differences`);
}
