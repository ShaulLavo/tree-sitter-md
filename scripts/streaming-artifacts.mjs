import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export function streamingArtifacts() {
  const require = createRequire(import.meta.url)
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const runtime = JSON.parse(readFileSync(join(dirname(require.resolve('web-tree-sitter')), 'package.json'), 'utf8'))
  return {
    packageVersion: metadata.version,
    runtimeVersion: runtime.version,
    runtimePin: metadata.overrides['web-tree-sitter'],
    wasm: Object.fromEntries(['tree-sitter-md.wasm', 'tree-sitter-markdown.wasm', 'tree-sitter-markdown-math.wasm'].map(name => [
      name, createHash('sha256').update(readFileSync(new URL('../' + name, import.meta.url))).digest('hex'),
    ])),
  }
}
