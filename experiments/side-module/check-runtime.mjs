import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const path=process.env.WEB_TREE_SITTER ?? '/work/projects/Editor/node_modules/.bun/web-tree-sitter@0.27.0/node_modules/web-tree-sitter/web-tree-sitter.js';
const {Parser,Language}=await import(path);
const host={};await Parser.init(host);
const bytes=readFileSync(new URL('../../target/c/resolver-side.wasm',import.meta.url));
const side=await WebAssembly.compile(bytes);
const runtime=await WebAssembly.compile(readFileSync(path.replace(/\.js$/,'.wasm')));
const exported=new Set(WebAssembly.Module.exports(runtime).map(x=>x.name));
const missing=WebAssembly.Module.imports(side).filter(x=>x.name.startsWith('ts_') && !exported.has(x.name)).map(x=>x.name).sort();
console.log(JSON.stringify({missingRawRuntimeExports:missing},null,2));
assert(missing.includes('ts_parser_new'));
try {
  const language=await Language.load(bytes);
  const exports=await host.loadWebAssemblyModule(bytes,{loadAsync:true});
  exports.tsmd_new(1);
  assert.fail('Stock runtime unexpectedly supplied all raw APIs');
} catch(error) {
  assert.match(error.message,/ts_parser_new|undefined symbol|resolved is not a function/);
  console.log('Expected stock-host failure:',error.message);
}
