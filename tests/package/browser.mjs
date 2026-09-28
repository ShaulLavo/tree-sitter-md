import { check } from './check.mjs'
import grammar from 'tree-sitter-md/tree-sitter-markdown.wasm?url'
import resolver from 'tree-sitter-md/tree-sitter-md.wasm?url'
import host from 'web-tree-sitter/web-tree-sitter.wasm?url'

try {
  const order = new URL(location.href).searchParams.get('order')
  window.result = await check(order, { grammar, resolver }, { locateFile: () => host })
} catch (error) {
  window.failure = error.stack
}
