import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {init,MarkdownDocument} from '../js/index.js';

import {repositoryDocuments} from '../bench/repositories.mjs';
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
  await init(wasm);
  const doc=new MarkdownDocument(), results=[];
  for(const {name,text} of repositoryDocuments()) {
    const expected=fromMdast(text,fromMarkdown(text,{extensions:[gfm()],mdastExtensions:[gfmFromMarkdown()]}));
    doc.setText(text);
    const actual=fromTsmd(text,doc.decorations(0,text.length));
    const {missing,extra}=compare(expected,actual,{ignore:new Set(['tight','math','imath'])});
    results.push({name,sha256:createHash('sha256').update(text).digest('hex'),missing,extra});
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
