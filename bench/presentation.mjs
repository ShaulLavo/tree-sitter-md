import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { availableParallelism, cpus, freemem, loadavg, release, totalmem, type, version } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { streamingArtifacts } from '../scripts/streaming-artifacts.mjs'
import { loadPresentationCase, presentationCases } from './presentation-cases.mjs'

const entry = fileURLToPath(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const childrenFields = ['children', 'items', 'rows', 'cells']
const gcPasses = 3

function integer(value, name, minimum, maximum) {
  if (!/^\d+$/u.test(value ?? '')) throw new TypeError(name + ' requires an integer')
  const parsed = Number(value)
  if (parsed < minimum || parsed > maximum) throw new RangeError(name + ' must be ' + minimum + '..' + maximum)
  return parsed
}

function configuration(args) {
  const config = { samples: 5, warmup: 1, timeoutMs: 120000, cases: [], worker: null, help: false, list: false }
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--help') { config.help = true; continue }
    if (argument === '--list') { config.list = true; continue }
    if (argument === '--case') { config.cases.push(args[++index]); continue }
    if (argument === '--worker') { config.worker = args[++index]; assert.ok(config.worker, '--worker requires a case name'); continue }
    if (argument === '--samples') { config.samples = integer(args[++index], argument, 1, 30); continue }
    if (argument === '--warmup') { config.warmup = integer(args[++index], argument, 0, 10); continue }
    if (argument === '--timeout-ms') { config.timeoutMs = integer(args[++index], argument, 1000, 300000); continue }
    throw new TypeError('unknown argument: ' + argument)
  }
  const ids = presentationCases().map(value => value.id)
  if (config.worker) config.cases.push(config.worker)
  if (!config.cases.length) config.cases = ids
  assert.ok(config.cases.every(id => ids.includes(id)), '--case and --worker require a name from --list')
  assert.equal(new Set(config.cases).size, config.cases.length, 'case names must be unique')
  return config
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function fileIdentity(path) {
  const bytes = readFileSync(path)
  return { bytes: bytes.length, sha256: digest(bytes) }
}

function artifacts() {
  const require = createRequire(import.meta.url)
  const runtimeEntry = require.resolve('web-tree-sitter')
  const files = ['js/index.js', 'js/semantic.js', 'js/constants.js', 'package.json', 'bun.lock', 'bench/presentation.mjs', 'bench/presentation-cases.mjs']
  return {
    ...streamingArtifacts(),
    files: Object.fromEntries(files.map(file => [file, fileIdentity(join(root, file))])),
    runtime: { entry: fileIdentity(runtimeEntry), wasm: fileIdentity(join(dirname(runtimeEntry), 'web-tree-sitter.wasm')) },
  }
}

function gitIdentity() {
  try {
    return {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
      changes: execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').filter(Boolean),
    }
  } catch {
    return { commit: null, changes: null, reason: 'Git metadata is unavailable; artifact hashes identify the measured files' }
  }
}

function environment() {
  const processors = cpus()
  return {
    os: { type: type(), release: release(), version: version(), architecture: process.arch, platform: process.platform },
    hardware: { cpuModels: Array.from(new Set(processors.map(cpu => cpu.model))), logicalCpuCount: processors.length, availableParallelism: availableParallelism(), totalMemoryBytes: totalmem() },
    runtime: { node: process.version, versions: process.versions, executable: process.execPath, execArgv: process.execArgv },
  }
}

function hostObservation() {
  return { at: new Date().toISOString(), loadAverage: loadavg(), freeMemoryBytes: freemem() }
}

function collect() {
  assert.equal(typeof globalThis.gc, 'function', 'workers require Node --expose-gc')
  for (let index = 0; index < gcPasses; index++) globalThis.gc()
}

function memory(api) {
  collect()
  return { ...process.memoryUsage(), wasmLinearMemoryCapacityBytes: api?.memoryBytes() ?? 0 }
}

function identity(workload) {
  assert.ok(typeof workload.source === 'string' && workload.source.length > 0, 'baseline input must be a nonempty string')
  const utf8Bytes = Buffer.byteLength(workload.source, 'utf8')
  assert.ok(utf8Bytes <= 256 * 1024, 'baseline inputs are bounded to 256 KiB')
  if (workload.provenance.targetUtf8Bytes) assert.equal(utf8Bytes, workload.provenance.targetUtf8Bytes, 'generated input size differs from its case contract')
  const utf16leSha256 = digest(Buffer.from(workload.source, 'utf16le'))
  const source = {
    utf16CodeUnits: workload.source.length,
    utf8Bytes,
    utf16leSha256,
    utf8Sha256: digest(Buffer.from(workload.source, 'utf8')),
  }
  return {
    id: workload.id, description: workload.description, options: workload.options, provenance: workload.provenance, source,
    caseSha256: digest(JSON.stringify({ id: workload.id, options: workload.options, utf16leSha256 })),
  }
}

function validateSnapshots(exact, open, ended, source, options) {
  assert.ok(open.source === source, 'open presentation must retain received source')
  assert.ok(ended.source === source, 'ended presentation must retain received source')
  assert.equal(open.input, 'open')
  assert.equal(ended.input, 'ended')
  assert.deepEqual(ended.provisional, [])
  assert.deepEqual(ended.suppressed, [])
  assert.equal(exact.revision, 1, 'snapshot reads must preserve the setText revision')
  assert.equal(open.revision, exact.revision)
  assert.equal(ended.revision, exact.revision)
  assert.equal(exact.profile, 'gfm-extended')
  assert.deepEqual(exact.capabilities, { commonmark: true, gfm: options.gfm, footnotes: options.gfm, math: options.math, cjk: options.cjk })
  assert.deepEqual(open.capabilities, exact.capabilities)
  assert.equal(open.profile, exact.profile)
  const { source: ignoredSource, input, provisional, suppressed, references, ...canonical } = ended
  assert.ok(isDeepStrictEqual(canonical, exact), 'ended output must agree with exact semantics')
}

function addChildren(stack, children) {
  if (!Array.isArray(children)) return
  for (const child of children) stack.push(child)
}

function nodeCounts(rootNode) {
  const stack = [rootNode]
  const types = {}
  let total = 0
  while (stack.length) {
    const node = stack.pop()
    total++
    types[node.type] = (types[node.type] ?? 0) + 1
    for (const field of childrenFields) addChildren(stack, node[field])
  }
  return { total, types }
}

function snapshotSize(snapshot) {
  const serialized = JSON.stringify(snapshot)
  return {
    serializedUtf8Bytes: Buffer.byteLength(serialized, 'utf8'), serializedUtf16CodeUnits: serialized.length,
    serializedSha256: digest(serialized), nodes: nodeCounts(snapshot.root),
    provisionalRecords: snapshot.provisional?.length ?? 0,
    suppressedRecords: snapshot.suppressed?.length ?? 0,
    referenceRecords: snapshot.references?.length ?? 0,
  }
}

function elapsed(operation) {
  const started = performance.now()
  const value = operation()
  return { value, ms: performance.now() - started }
}

function retain(api, id, stages) {
  let workload = loadPresentationCase(id)
  const caseIdentity = identity(workload)
  stages.withSource = memory(api)
  let document = new api.MarkdownDocument(workload.options)
  let exact = null
  let open = null
  let ended = null
  const firstCallMs = {}
  try {
    firstCallMs.setText = elapsed(() => document.setText(workload.source)).ms
    stages.afterParse = memory(api)
    firstCallMs.exact = elapsed(() => { exact = document.semantics() }).ms
    stages.withExactSnapshot = memory(api)
    firstCallMs.open = elapsed(() => { open = document.presentation({ input: 'open' }) }).ms
    stages.withExactAndOpenSnapshots = memory(api)
    firstCallMs.ended = elapsed(() => { ended = document.presentation({ input: 'ended' }) }).ms
    stages.withAllSnapshots = memory(api)
    validateSnapshots(exact, open, ended, workload.source, workload.options)
    const snapshots = { exact: snapshotSize(exact), open: snapshotSize(open), ended: snapshotSize(ended) }
    exact = null
    open = null
    ended = null
    stages.afterSnapshotRelease = memory(api)
    document.dispose()
    document = null
    stages.afterDisposeWithSource = memory(api)
    workload = null
    stages.afterSourceRelease = memory(api)
    return { caseIdentity, firstCallMs, snapshots }
  } finally {
    document?.dispose()
  }
}

function timingSample(api, workload) {
  const document = new api.MarkdownDocument(workload.options)
  try {
    const setText = elapsed(() => document.setText(workload.source)).ms
    const exact = elapsed(() => document.semantics())
    const open = elapsed(() => document.presentation({ input: 'open' }))
    const ended = elapsed(() => document.presentation({ input: 'ended' }))
    validateSnapshots(exact.value, open.value, ended.value, workload.source, workload.options)
    return { setText, exact: exact.ms, open: open.ms, ended: ended.ms }
  } finally {
    document.dispose()
  }
}

function summarize(values) {
  const sorted = values.toSorted((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return { samples: values, minimum: sorted[0], median, p95: sorted[Math.ceil(sorted.length * 0.95) - 1], maximum: sorted.at(-1) }
}

function timings(api, config, expectedIdentity) {
  const workload = loadPresentationCase(config.worker)
  assert.equal(identity(workload).caseSha256, expectedIdentity.caseSha256, 'timing and memory inputs must be identical')
  for (let index = 0; index < config.warmup; index++) timingSample(api, workload)
  const samples = []
  for (let index = 0; index < config.samples; index++) {
    collect()
    samples.push(timingSample(api, workload))
  }
  return Object.fromEntries(['setText', 'exact', 'open', 'ended'].map(method => [method, summarize(samples.map(sample => sample[method]))]))
}

async function worker(config) {
  const measuredArtifacts = artifacts()
  const stages = { beforeImport: memory() }
  const importStarted = performance.now()
  const api = await import('../js/index.js')
  const importMs = performance.now() - importStarted
  stages.afterImport = memory(api)
  const initStarted = performance.now()
  await api.init()
  const coldInitMs = performance.now() - initStarted
  stages.afterInit = memory(api)
  const retained = retain(api, config.worker, stages)
  const timingMs = timings(api, config, retained.caseIdentity)
  assert.deepEqual(artifacts(), measuredArtifacts, 'measured artifacts changed during the worker')
  return { ...retained, importMs, coldInitMs, timingMs, memory: { explicitGc: true, gcPassesPerStage: gcPasses, stages }, artifacts: measuredArtifacts }
}

let activeChild = null

function cleanupOnSignal(signal) {
  activeChild?.kill('SIGKILL')
  process.exit(signal === 'SIGINT' ? 130 : 143)
}

function finishChild(state, resolve, reject, code, signal) {
  clearTimeout(state.timeout)
  activeChild = null
  if (code !== 0) { reject(new Error(state.id + ' failed: exit=' + code + ' signal=' + signal + '\n' + state.stderr)); return }
  try { resolve(JSON.parse(state.stdout)) } catch (error) { reject(error) }
}

function child(config, id) {
  const args = ['--expose-gc', entry, '--worker', id, '--samples', String(config.samples), '--warmup', String(config.warmup)]
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    activeChild = processChild
    const state = { id, stdout: '', stderr: '', timeout: setTimeout(() => processChild.kill('SIGKILL'), config.timeoutMs) }
    processChild.stdout.setEncoding('utf8').on('data', chunk => { state.stdout += chunk })
    processChild.stderr.setEncoding('utf8').on('data', chunk => { state.stderr = (state.stderr + chunk).slice(-16384) })
    processChild.once('error', reject)
    processChild.once('close', (code, signal) => finishChild(state, resolve, reject, code, signal))
  })
}

async function baseline(config) {
  process.once('SIGINT', cleanupOnSignal)
  process.once('SIGTERM', cleanupOnSignal)
  const report = {
    schemaVersion: 1, kind: 'complete-document-presentation-baseline',
    started: hostObservation(), environment: environment(), repository: gitIdentity(),
    configuration: { caseIds: config.cases, samplesPerCase: config.samples, warmupPerCase: config.warmup, timeoutMsPerCase: config.timeoutMs },
    method: {
      isolation: 'One fresh Node process and shared Wasm runtime per case; cases run sequentially',
      coldInit: 'One init call per case, after module import; filesystem caches are uncontrolled',
      timing: 'Fresh document per sample; full setText, semantics, open presentation, ended presentation in that order; complete native copy and strict JavaScript decoding included',
      firstCalls: 'Before timing warmup; explicit GC separates each retained-state measurement',
      samples: 'Explicit GC before each sample, outside timing; document construction, validation, summaries and disposal are outside timing',
      memory: 'Process-wide post-GC JavaScript heap and process memory counters; shared Wasm linear-memory capacity is a high-water capacity and includes free allocator space',
      retention: 'Source, document and then exact/open/ended snapshots accumulate; snapshots, document and source are subsequently released',
      serializedSize: 'UTF-8 bytes of JSON.stringify(snapshot); this includes presentation source fields and is not JavaScript heap usage',
      statistics: 'Median averages the middle pair for even sample counts; p95 uses nearest rank ceil(n * 0.95); raw millisecond samples are retained',
      limits: 'No viewport/render timing, allocation census, peak resident memory, performance threshold or speedup claim',
    },
    cases: [],
  }
  for (const id of config.cases) {
    process.stderr.write('Measuring ' + id + '\n')
    const result = await child(config, id)
    if (report.cases.length) assert.deepEqual(result.artifacts, report.cases[0].artifacts, 'artifacts differ between isolated cases')
    report.cases.push(result)
  }
  report.finished = hostObservation()
  return report
}

assert.ok(!process.versions.bun && Number(process.versions.node.split('.')[0]) >= 26, 'Run this baseline with Node >=26')
const config = configuration(process.argv.slice(2))
if (config.help) {
  console.log('Usage: node bench/presentation.mjs [--case ID] [--samples 1..30] [--warmup 0..10] [--timeout-ms 1000..300000]\nDefaults: all cases, 5 samples, 1 warmup, 120000 ms per case. Each case uses a fresh Node --expose-gc worker.\nUse --list to list cases. JSON goes to stdout; progress goes to stderr.')
} else if (config.list) {
  console.log(JSON.stringify(presentationCases(), null, 2))
} else {
  console.log(JSON.stringify(config.worker ? await worker(config) : await baseline(config), null, 2))
}
