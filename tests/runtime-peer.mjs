import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('the Markdown binding requires its host runtime as a peer', () => {
  assert.equal(manifest.dependencies?.['web-tree-sitter'], undefined)
  assert.equal(manifest.peerDependencies['web-tree-sitter'], '^0.28.1')
  assert.equal(manifest.peerDependenciesMeta?.['web-tree-sitter']?.optional, undefined)
  assert.match(manifest.devDependencies['web-tree-sitter'], /^github:ShaulLavo\/tree-sitter-x#[0-9a-f]{40}$/)
  assert.equal(manifest.overrides['web-tree-sitter'], manifest.devDependencies['web-tree-sitter'])
})
