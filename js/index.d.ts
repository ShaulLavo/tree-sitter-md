export declare const Kind: Readonly<{
  Paragraph: 1; Heading: 2; ThematicBreak: 3; CodeBlock: 4; BlockQuote: 5; List: 6; ListItem: 7
  Task: 8; HtmlBlock: 9; Definition: 10; Table: 11; Emphasis: 12; Strong: 13; Strikethrough: 14
  CodeSpan: 15; Link: 16; Image: 17; HtmlInline: 18; HardBreak: 19; Frontmatter: 20
  HeadingMark: 32; ListMark: 33; QuoteMark: 34; FenceMark: 35; CodeInfo: 36; TaskMark: 37
  TableDelimiterRow: 38; LinkText: 39
}>

export declare const CAPTURES: readonly (string | null)[]

import type { Language } from 'web-tree-sitter'

export type WasmSource = URL | string | Response | Promise<Response> | ArrayBuffer | ArrayBufferView | WebAssembly.Module

export declare function init(options?: {
  /** The block grammar, tree-sitter-markdown.wasm, or a Language already loaded by tree-sitter-x. */
  grammar?: Exclude<WasmSource, WebAssembly.Module> | Language
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
