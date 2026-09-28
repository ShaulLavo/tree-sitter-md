export { Kind, CAPTURES } from './constants.js'

import type { Language } from 'web-tree-sitter'

export type WasmSource = URL | string | Response | Promise<Response> | ArrayBuffer | ArrayBufferView | WebAssembly.Module

export declare function init(options?: {
  /** The block grammar, tree-sitter-markdown.wasm, or a Language already loaded by tree-sitter-x. */
  grammar?: URL | string | Response | Promise<Response> | ArrayBuffer | ArrayBufferView | Language
  /** The resolver, tree-sitter-md.wasm, loaded as a tree-sitter-x extension. */
  resolver?: WasmSource
}): Promise<void>
export declare function memoryBytes(): number

export declare class MarkdownDocument {
  constructor(options?: { gfm?: boolean; frontmatter?: boolean })
  setText(text: string): void
  edit(start: number, oldEnd: number, inserted: string): void
  reparse(): void
  decorations(from: number, to: number): Uint32Array
  decorationsForRows(fromRow: number, toRow: number): Uint32Array
  highlights(from: number, to: number): Uint32Array
  folds(from: number, to: number): Uint32Array
  injections(from: number, to: number): Uint32Array
  rowStart(row: number): number
  readonly lineCount: number
  dispose(): void
}
