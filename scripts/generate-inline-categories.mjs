import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[2]
if (!modulePath) {
  throw new TypeError('Pass the micromark-extension-cjk-friendly-util/dist/index.js path')
}
const moduleUrl = pathToFileURL(resolve(modulePath))
const { classifyCharacter } = await import(moduleUrl.href)
const packageInfo = JSON.parse(await readFile(new URL('../package.json', moduleUrl), 'utf8'))
const widthModule = createRequire(moduleUrl).resolve('get-east-asian-width')
const widthInfo = JSON.parse(await readFile(join(dirname(widthModule), 'package.json'), 'utf8'))
if (packageInfo.version !== '3.0.1' || widthInfo.version !== '1.7.0' || process.versions.unicode !== '17.0') {
  throw new TypeError('The frozen CJK profile uses utility 3.0.1, East Asian Width 1.7.0 and Unicode 17.0')
}
const range = []
let previous = classifyCharacter(0)
let start = 0
for (let scalar = 1; scalar <= 0x110000; scalar += 1) {
  const category = scalar < 0x110000 ? classifyCharacter(scalar) : 0
  if (category === previous) continue
  if (previous) range.push(`  {0x${start.toString(16)}, 0x${(scalar - 1).toString(16)}, ${previous}},`)
  start = scalar
  previous = category
}
const classifier = await readFile(new URL('./classifyCharacter.js', moduleUrl))
const characters = await readFile(new URL('./characterWithNonBmp.js', moduleUrl))
const hash = createHash('sha256').update(classifier).update(characters).digest('hex')
const header = `/* Generated from CJK utility ${packageInfo.version}, East Asian Width ${widthInfo.version}, Unicode ${process.versions.unicode}.
 * Classifier sha256: ${hash}. See scripts/generate-inline-categories.mjs. */\n`
const output = new URL('../vendor/cmark/cjk_categories.inc', import.meta.url)
await writeFile(output, header + range.join('\n') + '\n')
console.log(`${range.length} category ranges written`)
