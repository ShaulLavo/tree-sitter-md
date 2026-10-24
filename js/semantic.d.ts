export type SemanticRange = { readonly start: number; readonly end: number }
export type Alignment = 'left' | 'center' | 'right' | null
type Base = { readonly range: SemanticRange }
type CodeSourceRun =
  | { readonly kind: 'copy'; readonly valueStart: number; readonly length: number; readonly tokenOffset: number }
  | { readonly kind: 'atom'; readonly valueStart: number; readonly valueLength: number; readonly tokenOffset: number; readonly sourceLength: number }
type CodeSourceMap = {
  readonly value: string
  readonly tokenLength: number
  readonly runs: readonly CodeSourceRun[]
}
export type SemanticInline = Base & (
  | { readonly type: 'text' | 'html' | 'math'; readonly value: string }
  | { readonly type: 'code'; readonly value: string; readonly sourceValue: string; readonly sourceMap: CodeSourceMap }
  | { readonly type: 'emphasis' | 'strong' | 'delete'; readonly children: readonly SemanticInline[] }
  | { readonly type: 'break'; readonly hard: boolean }
  | { readonly type: 'link'; readonly children: readonly SemanticInline[]; readonly url: string; readonly title: string | null } & (
      | { readonly origin: 'markdown' | 'autolink' }
      | { readonly origin: 'gfm-autolink'; readonly sourceUrl: string; readonly sourceValue: string }
    )
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
  | { readonly type: 'html'; readonly value: string }
  | { readonly type: 'math'; readonly value: string; readonly meta: string | null }
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
  readonly profile: 'commonmark' | 'gfm' | 'gfm-extended'
  readonly capabilities: SemanticCapabilities
  readonly root: SemanticRoot
}
export type PresentationInput = 'open' | 'ended'
export type PresentationProvisional = {
  readonly path: readonly (string | number)[]
  readonly reason: string
}
export type PresentationSuppressed = {
  readonly range: SemanticRange
  readonly reason: string
}
export type PresentationReference = {
  readonly kind: 'link' | 'footnote'
  readonly identifier: string
  readonly range: SemanticRange
  readonly resolution: 'resolved' | 'unresolved'
}
type PresentationChildren<Node> = {
  readonly [Key in keyof Node]: Key extends 'children'
    ? Node[Key] extends readonly SemanticInline[] ? readonly PresentationInline[] : readonly PresentationBlock[]
    : Key extends 'items' ? readonly PresentationListItem[]
    : Key extends 'rows' ? readonly PresentationTableRow[]
    : Key extends 'cells' ? readonly PresentationTableCell[]
    : Node[Key]
}
export type PresentationInline = PresentationChildren<SemanticInline> | Base & (
  | { readonly type: 'pendingLink'; readonly children: readonly PresentationInline[] }
  | { readonly type: 'pendingImage'; readonly alt: string }
  | { readonly type: 'pendingMath'; readonly value: string }
)
export type PresentationListItem = PresentationChildren<SemanticListItem>
export type PresentationTableCell = PresentationChildren<SemanticTableCell>
export type PresentationTableRow = PresentationChildren<SemanticTableRow>
export type PresentationBlock = PresentationChildren<SemanticBlock>
  | Base & { readonly type: 'pendingMath'; readonly value: string; readonly meta: string | null }
export type PresentationRoot = PresentationChildren<SemanticRoot>
type PresentationMetadata = Omit<SemanticSnapshot, 'root'> & {
  readonly source: string
  readonly references: readonly PresentationReference[]
}
export type PresentationSnapshot<Input extends PresentationInput = PresentationInput> = PresentationMetadata & (
  Input extends 'ended' ? {
    readonly input: 'ended'
    readonly root: SemanticRoot
    readonly provisional: readonly []
    readonly suppressed: readonly []
  } : {
    readonly input: 'open'
    readonly root: PresentationRoot
    readonly provisional: readonly PresentationProvisional[]
    readonly suppressed: readonly PresentationSuppressed[]
  }
)
