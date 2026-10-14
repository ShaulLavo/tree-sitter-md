export type SemanticRange = { readonly start: number; readonly end: number }
export type Alignment = 'left' | 'center' | 'right' | null
type Base = { readonly range: SemanticRange }
export type SemanticInline = Base & (
  | { readonly type: 'text' | 'code' | 'html' | 'math'; readonly value: string }
  | { readonly type: 'emphasis' | 'strong' | 'delete'; readonly children: readonly SemanticInline[] }
  | { readonly type: 'break'; readonly hard: boolean }
  | { readonly type: 'link'; readonly children: readonly SemanticInline[]; readonly url: string; readonly title: string | null }
  | { readonly type: 'image'; readonly alt: string; readonly url: string; readonly title: string | null }
  | { readonly type: 'footnoteReference'; readonly identifier: string }
)
export type SemanticListItem = Base & {
  readonly type: 'listItem'
  readonly children: readonly SemanticBlock[]
  readonly spread: boolean
  readonly checked: boolean | null
}
export type SemanticTableCell = { readonly type: 'tableCell'; readonly range: SemanticRange | null; readonly children: readonly SemanticInline[] }
export type SemanticTableRow = Base & { readonly type: 'tableRow'; readonly cells: readonly SemanticTableCell[] }
export type SemanticBlock = Base & (
  | { readonly type: 'paragraph'; readonly children: readonly SemanticInline[] }
  | { readonly type: 'heading'; readonly depth: 1 | 2 | 3 | 4 | 5 | 6; readonly children: readonly SemanticInline[] }
  | { readonly type: 'quote'; readonly children: readonly SemanticBlock[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly start: number | null; readonly spread: boolean; readonly items: readonly SemanticListItem[] }
  | { readonly type: 'code'; readonly value: string; readonly language: string | null; readonly meta: string | null; readonly fence: 'open' | 'closed' | 'indented' }
  | { readonly type: 'html' | 'math'; readonly value: string }
  | { readonly type: 'thematicBreak' }
  | { readonly type: 'table'; readonly align: readonly Alignment[]; readonly rows: readonly SemanticTableRow[] }
  | { readonly type: 'definition'; readonly identifier: string; readonly url: string; readonly title: string | null }
  | { readonly type: 'footnoteDefinition'; readonly identifier: string; readonly children: readonly SemanticBlock[] }
)
export type SemanticRoot = Base & { readonly type: 'root'; readonly children: readonly SemanticBlock[] }
export type SemanticCapabilities = {
  readonly commonmark: true
  readonly gfm: boolean
  readonly math: boolean
  readonly cjk: boolean
  readonly footnotes: boolean
}
export type SemanticSnapshot = {
  readonly revision: number
  readonly profile: 'commonmark' | 'gfm' | 'fregat-chat'
  readonly capabilities: SemanticCapabilities
  readonly root: SemanticRoot
}
