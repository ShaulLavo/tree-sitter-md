import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const compiler = ['cc', 'clang', 'gcc'].find(command => spawnSync(command, ['--version']).status === 0)
test('native UTF16 attention bridge has no sanitizer or lifetime errors', {
  skip: compiler ? false : 'A native C compiler is required for the UTF16 context checks',
}, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'tree-sitter-md-utf16-'))
  const cleanup = () => rmSync(scratch, { recursive: true, force: true })
  const interrupted = () => { cleanup(); process.exit(130) }
  process.once('SIGINT', interrupted)
  process.once('SIGTERM', interrupted)
  try {
    const binary = join(scratch, 'attention')
    const flags = ['-std=c11', '-g', '-O1', '-ffunction-sections', '-fdata-sections', '-fsanitize=address,undefined',
      '-fno-omit-frame-pointer', '-D_POSIX_C_SOURCE=200809L', '-D_DEFAULT_SOURCE', '-Isrc', '-Ivendor/cmark', '-Ivendor/tree-sitter/include']
    const sources = ['allocator', 'buffer', 'cmark_ctype', 'houdini_html_u', 'inlines', 'node', 'references', 'scanners', 'utf8']
    const linker = process.platform === 'darwin' ? '-Wl,-dead_strip' : '-Wl,--gc-sections'
    const args = flags.concat(['tests/utf16-attention.c', 'src/leaf.c', 'src/autolink.c'], sources.map(name => `vendor/cmark/${name}.c`), [linker, '-o', binary])
    const built = spawnSync(compiler, args, { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 60_000 })
    assert.equal(built.status, 0, built.stderr || built.error?.message)
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, ASAN_OPTIONS: `detect_leaks=${process.platform === 'darwin' ? '0' : '1'}` } })
    assert.equal(run.status, 0, run.stderr || run.error?.message)
  } finally {
    process.off('SIGINT', interrupted)
    process.off('SIGTERM', interrupted)
    cleanup()
  }
})
