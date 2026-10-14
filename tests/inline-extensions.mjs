import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('../', import.meta.url))
const available = spawnSync('clang', ['--version'], { encoding: 'utf8' }).status === 0
const sources = ['allocator', 'buffer', 'cmark_ctype', 'houdini_html_u', 'inlines', 'node', 'references', 'scanners', 'utf8']
test('native inline math, CJK and footnote hooks preserve values and ranges', {
  skip: available ? false : 'clang is required for the native inline extension controls',
}, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'tree-sitter-md-inline-'))
  const cleanup = () => rmSync(scratch, { recursive: true, force: true })
  const interrupted = () => { cleanup(); process.exit(130) }
  process.once('SIGINT', interrupted)
  process.once('SIGTERM', interrupted)
  try {
    const binary = join(scratch, 'inline-extensions')
    const flags = ['-std=c11', '-g', '-O1', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-D_POSIX_C_SOURCE=200809L', '-D_DEFAULT_SOURCE', '-Ivendor/cmark']
    const compiler = spawnSync('clang', flags.concat(['tests/inline-extensions.c'], sources.map(name => `vendor/cmark/${name}.c`), ['-o', binary]), { cwd: root, encoding: 'utf8', timeout: 60_000 })
    assert.equal(compiler.status, 0, compiler.stderr || compiler.error?.message)
    const result = spawnSync(binary, [], { cwd: root, encoding: 'utf8', timeout: 60_000, env: { ...process.env, ASAN_OPTIONS: `detect_leaks=${process.platform === 'darwin' ? '0' : '1'}` } })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
  } finally {
    process.off('SIGINT', interrupted)
    process.off('SIGTERM', interrupted)
    cleanup()
  }
})
