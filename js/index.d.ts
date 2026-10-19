export { Kind, CAPTURES } from './constants.js'
export type { Alignment, SemanticRange, SemanticInline, SemanticBlock, SemanticListItem,
  SemanticTableCell, SemanticTableRow, SemanticRoot, SemanticSnapshot, SemanticCapabilities,
  PresentationInput, PresentationInline, PresentationBlock, PresentationListItem,
  PresentationTableCell, PresentationTableRow, PresentationRoot, PresentationSnapshot,
  PresentationProvisional, PresentationSuppressed, PresentationReference } from './semantic.js'

import type { Language } from 'web-tree-sitter'
import type { PresentationInput, PresentationSnapshot, SemanticSnapshot } from './semantic.js'

export type WasmSource = URL | string | Response | Promise<Response> | ArrayBuffer | ArrayBufferView | WebAssembly.Module

export declare function init(options?: {
  /** The block grammar, tree-sitter-markdown.wasm, or a Language already loaded by tree-sitter-x. */
  grammar?: URL | string | Response | Promise<Response> | ArrayBuffer | ArrayBufferView | Language
  /** The CHAT block grammar, tree-sitter-markdown-chat.wasm, selected for math-enabled documents. */
  chatGrammar?: URL | string | Response | Promise<Response> | ArrayBuffer | ArrayBufferView | Language
  /** The resolver, tree-sitter-md.wasm, loaded as a tree-sitter-x extension. */
  resolver?: WasmSource
}): Promise<void>
export declare function memoryBytes(): number

export declare class MarkdownDocument {
  constructor(options?: { gfm?: boolean; frontmatter?: boolean; cjk?: boolean; math?: boolean })
  setText(text: string): void
  edit(start: number, oldEnd: number, inserted: string): void
  reparse(): void
  semantics(): SemanticSnapshot
  presentation<Input extends PresentationInput>(options: { readonly input: Input }): PresentationSnapshot<Input>
  decorations(from: number, to: number): Uint32Array
  decorationsForRows(fromRow: number, toRow: number): Uint32Array
  highlights(from: number, to: number): Uint32Array
  folds(from: number, to: number): Uint32Array
  injections(from: number, to: number): Uint32Array
  rowStart(row: number): number
  readonly lineCount: number
  dispose(): void
}
