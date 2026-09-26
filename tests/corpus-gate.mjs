import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkDifferences} from '../scripts/check-repository.mjs';
const allowed={name:'fixture.md',sha256:'pinned',missing:['a@0-4'],extra:['p@5-9']};
test('corpus gate permits improvements to specific allowed differences',()=>{
  checkDifferences({...allowed,missing:[],extra:[]},allowed);
  checkDifferences(allowed,allowed);
});
test('corpus gate rejects replacements with identical aggregate counts',()=>{
  assert.throws(()=>checkDifferences({...allowed,missing:['a@10-14']},allowed),/unexpected missing/);
  assert.throws(()=>checkDifferences({...allowed,extra:['p@10-14']},allowed),/unexpected extra/);
});
test('corpus gate rejects duplicated differences and changed input',()=>{
  assert.throws(()=>checkDifferences({...allowed,missing:['a@0-4','a@0-4']},allowed),/unexpected missing/);
  assert.throws(()=>checkDifferences({...allowed,sha256:'changed'},allowed),/input changed/);
});
