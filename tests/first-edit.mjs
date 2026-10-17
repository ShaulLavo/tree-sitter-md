import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('the first edit of an empty document completes and preserves received UTF-16', () => {
  const binding = new URL('../js/index.js', import.meta.url).href
  const source = 'first\0'
  const script = `
    import assert from 'node:assert/strict'
    import { init, MarkdownDocument } from ${JSON.stringify(binding)}
    await init()
    const control = new MarkdownDocument()
    const fresh = new MarkdownDocument()
    const source = ${JSON.stringify(source)}
    try {
      control.setText('')
      control.edit(0, 0, source)
      fresh.edit(0, 0, source)
      assert.deepEqual(fresh.semantics().root, control.semantics().root)
      assert.equal(fresh.presentation({input:'open'}).source, source)
    } finally { control.dispose(); fresh.dispose() }
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 5000,
  })
  assert.equal(result.error, undefined, 'first edit must complete within the bounded child process')
  assert.equal(result.status, 0, result.stderr)
})
