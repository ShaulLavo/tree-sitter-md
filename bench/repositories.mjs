import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

export function repositoryDocuments() {
  return JSON.parse(gunzipSync(readFileSync(new URL('./corpus/repositories.json.gz', import.meta.url))).toString())
}
