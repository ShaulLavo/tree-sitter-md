// Record kinds and capture names: plain data, so importing them never loads web-tree-sitter.

/** Record kinds. Records are `[start, end, kind, extra]`. */
export const Kind = Object.freeze({
  Paragraph: 1,
  Heading: 2, // extra: level
  ThematicBreak: 3,
  CodeBlock: 4, // extra: 1 fenced
  BlockQuote: 5,
  List: 6, // extra: 1 ordered
  ListItem: 7,
  Task: 8, // extra: 1 checked
  HtmlBlock: 9,
  Definition: 10,
  Table: 11, // extra: column count in the low byte, then 2 bits per column (0 none, 1 left, 2 center, 3 right)
  Emphasis: 12,
  Strong: 13,
  Strikethrough: 14,
  CodeSpan: 15,
  Link: 16,
  Image: 17,
  HtmlInline: 18,
  HardBreak: 19,
  Frontmatter: 20,
  HeadingMark: 32,
  ListMark: 33,
  QuoteMark: 34,
  FenceMark: 35,
  CodeInfo: 36,
  TaskMark: 37,
  TableDelimiterRow: 38,
  LinkText: 39, // the text of a link or image, inside its brackets
})

/** Capture names of highlight triples `[start, end, capture]`, indexed by capture id. */
export const CAPTURES = Object.freeze([
  null,
  'text.title',
  'punctuation.special',
  'text.literal',
  'punctuation.delimiter',
  'text.uri',
  'text.reference',
  'string.escape',
  'text.emphasis',
  'text.strong',
])
