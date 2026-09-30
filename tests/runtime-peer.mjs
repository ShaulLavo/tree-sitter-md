import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('the Markdown binding requires its host runtime as a peer', () => {
  assert.equal(manifest.dependencies?.['web-tree-sitter'], undefined)
  assert.match(manifest.peerDependencies['web-tree-sitter'], /^github:ShaulLavo\/tree-sitter-x#/)
  assert.equal(manifest.peerDependenciesMeta?.['web-tree-sitter']?.optional, undefined)
  assert.equal(manifest.devDependencies['web-tree-sitter'], manifest.peerDependencies['web-tree-sitter'])
})
