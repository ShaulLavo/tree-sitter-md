import assert from "node:assert/strict";
import { test } from "node:test";
import { init, MarkdownDocument } from "../js/index.js";
import type { SemanticBlock, SemanticRoot, SemanticTableCell } from "../js/semantic.js";

await init();

const range = (start: number, end: number) => ({ start, end });
const cell = (value: string, start: number, end: number, textStart: number): SemanticTableCell => ({
  type: "tableCell",
  range: range(start, end),
  children: [{ type: "text", range: range(textStart, textStart + value.length), value }],
});
const padding: SemanticTableCell = { type: "tableCell", range: null, children: [] };

function table(
  start: number,
  body: number,
  end: number,
): Extract<SemanticBlock, { type: "table" }> {
  return {
    type: "table",
    range: range(start, end),
    align: [null, null],
    rows: [
      {
        type: "tableRow",
        range: range(start, start + 9),
        cells: [cell("a", start, start + 4, start + 2), cell("b", start + 4, start + 9, start + 6)],
      },
      {
        type: "tableRow",
        range: range(body, end),
        cells: [cell("c", body, end, body + 2), padding],
      },
    ],
  };
}

function quoteExpected(prefix: string, eol: string): SemanticRoot {
  const body = 18 + 3 * prefix.length + 2 * eol.length;
  const end = body + 5;
  return {
    type: "root",
    range: range(0, end),
    children: [
      { type: "quote", range: range(0, end), children: [table(prefix.length, body, end)] },
    ],
  };
}

function footnoteExpected(eols: readonly string[]): SemanticRoot {
  const definition = 5 + eols[0].length + eols[1].length;
  const start = definition + 9 + eols[2].length;
  const body = start + 28 + eols[3].length + eols[4].length;
  const end = body + 5;
  return {
    type: "root",
    range: range(0, end),
    children: [
      {
        type: "paragraph",
        range: range(0, 5),
        children: [
          { type: "text", range: range(0, 1), value: "x" },
          { type: "footnoteReference", range: range(1, 5), identifier: "a" },
        ],
      },
      {
        type: "footnoteDefinition",
        range: range(definition, end),
        identifier: "a",
        children: [table(start, body, end)],
      },
    ],
  };
}

function quoteSource(prefix: string, eol: string): string {
  return [prefix + "| a | b |", prefix + "|---|---|", prefix + "| c |"].join(eol);
}

function footnoteSource(eols: readonly string[]): string {
  return (
    "x[^a]" +
    eols[0] +
    eols[1] +
    "[^a]:" +
    eols[2] +
    "    | a | b |" +
    eols[3] +
    "    |---|---|" +
    eols[4] +
    "      | c |"
  );
}

function snapshots(document: MarkdownDocument) {
  const { revision, ...exact } = document.semantics();
  const { revision: openRevision, ...open } = document.presentation({ input: "open" });
  const { revision: endedRevision, ...ended } = document.presentation({ input: "ended" });
  assert.equal(openRevision, revision);
  assert.equal(endedRevision, revision);
  return { exact, open, ended };
}

function check(document: MarkdownDocument, source: string, expected: SemanticRoot) {
  const result = snapshots(document);
  assert.deepEqual(result.exact.root, expected);
  assert.deepEqual(result.open.root, expected);
  assert.deepEqual(result.ended.root, expected);
  assert.equal(result.open.source, source);
  assert.equal(result.ended.source, source);
  return result;
}

function checkDocument(source: string, expected: SemanticRoot, math: boolean): void {
  const document = new MarkdownDocument({ math });
  try {
    document.setText(source);
    const before = check(document, source, expected);
    document.reparse();
    assert.deepEqual(check(document, source, expected), before);
  } finally {
    document.dispose();
  }
}

function registerEol(eol: string, math: boolean): void {
  const eols = [eol, eol, eol, eol, eol];
  test("original quoted table " + JSON.stringify({ eol, math }), () =>
    checkDocument(quoteSource(">   ", eol), quoteExpected(">   ", eol), math),
  );
  test("original footnote table " + JSON.stringify({ eol, math }), () =>
    checkDocument(footnoteSource(eols), footnoteExpected(eols), math),
  );
  for (const indent of [0, 1, 2, 3]) {
    const prefix = "> " + " ".repeat(indent);
    test("quote residual allowance " + JSON.stringify({ indent, eol, math }), () =>
      checkDocument(quoteSource(prefix, eol), quoteExpected(prefix, eol), math),
    );
  }
}

for (const eol of ["\n", "\r\n", "\r"]) {
  for (const math of [false, true]) registerEol(eol, math);
}

function checkEdit(
  source: string,
  expected: SemanticRoot,
  at: number,
  end: number,
  replacement: string,
  math: boolean,
): void {
  const document = new MarkdownDocument({ math });
  const fresh = new MarkdownDocument({ math });
  try {
    document.setText(source);
    const initial = check(document, source, expected);
    const edited = source.slice(0, at) + replacement + source.slice(end);
    document.edit(at, end, replacement);
    fresh.setText(edited);
    assert.deepEqual(snapshots(document), snapshots(fresh));
    document.edit(at, at + replacement.length, source.slice(at, end));
    assert.deepEqual(check(document, source, expected), initial);
    fresh.setText(source);
    assert.deepEqual(snapshots(fresh), initial);
    document.reparse();
    assert.deepEqual(check(document, source, expected), initial);
  } finally {
    document.dispose();
    fresh.dispose();
  }
}

function registerEdits(math: boolean): void {
  test("delimiter prefix edit and undo " + math, () =>
    checkEdit(quoteSource(">   ", "\n"), quoteExpected(">   ", "\n"), 16, 18, "", math),
  );
  const cr = ["\r", "\r", "\r", "\r", "\r"];
  test("footnote EOL and dedent edit and undo " + math, () =>
    checkEdit(footnoteSource(cr), footnoteExpected(cr), 26, 31, "\r\n\t", math),
  );
  const mixed = ["\r\n", "\r", "\n", "\r\n", "\r"];
  test("mixed physical endings preserve original units " + math, () =>
    checkDocument(footnoteSource(mixed), footnoteExpected(mixed), math),
  );
}

for (const math of [false, true]) registerEdits(math);

function checkCode(prefix: string, eol: string, math: boolean): void {
  const source = quoteSource(prefix, eol);
  const document = new MarkdownDocument({ math });
  try {
    document.setText(source);
    const expected: SemanticRoot = {
      type: "root",
      range: range(0, source.length),
      children: [
        {
          type: "quote",
          range: range(0, source.length),
          children: [
            {
              type: "code",
              range: range(2, source.length),
              fence: "indented",
              value: "| a | b |\n|---|---|\n| c |",
              language: null,
              meta: null,
            },
          ],
        },
      ],
    };
    check(document, source, expected);
  } finally {
    document.dispose();
  }
}

function checkParagraphs(eol: string, math: boolean): void {
  const source = ["x[^a]", "", "[^a]: first", "    second", "", "    third"].join(eol);
  const document = new MarkdownDocument({ math });
  try {
    document.setText(source);
    const state = snapshots(document);
    const note = state.exact.root.children[1];
    assert.equal(note.type, "footnoteDefinition");
    if (note.type !== "footnoteDefinition") return;
    assert.deepEqual(
      note.children.map((child) => child.type),
      ["paragraph", "paragraph"],
    );
    const last = note.children[1];
    assert.equal(last.type, "paragraph");
    if (last.type !== "paragraph") return;
    assert.deepEqual(last.children, [
      { type: "text", range: range(source.length - 5, source.length), value: "third" },
    ]);
    assert.deepEqual(note.range, range(5 + 2 * eol.length, source.length));
    assert.deepEqual(state.open.root, state.exact.root);
    assert.deepEqual(state.ended.root, state.exact.root);
    assert.equal(state.open.source, source);
    assert.equal(state.ended.source, source);
  } finally {
    document.dispose();
  }
}

function registerBoundaries(eol: string, math: boolean): void {
  for (const prefix of [">\t", "> \t", ">\t "]) {
    test("quote tab uses visual columns " + JSON.stringify({ prefix, eol, math }), () =>
      checkDocument(quoteSource(prefix, eol), quoteExpected(prefix, eol), math),
    );
  }
  for (const prefix of [">     ", ">\t  "]) {
    test("quote four residual columns retain code " + JSON.stringify({ prefix, eol, math }), () =>
      checkCode(prefix, eol, math),
    );
  }
  test("footnote paragraphs across physical lines " + JSON.stringify({ eol, math }), () =>
    checkParagraphs(eol, math),
  );
}

for (const eol of ["\n", "\r\n", "\r"]) {
  for (const math of [false, true]) registerBoundaries(eol, math);
}

const quotedCodePadding: readonly (readonly [string, number])[] = [
  [">\t   ", 1],
  [">\t    ", 2],
  [">\t     ", 3],
  [">\t\t", 2],
  ["> \t   ", 1],
  [">  \t   ", 1],
  [">   \t  ", 4],
];

function checkQuotedCodePadding(prefix: string, spaces: number, eol: string, math: boolean): void {
  const source = quoteSource(prefix, eol);
  const value = ["| a | b |", "|---|---|", "| c |"]
    .map((line) => " ".repeat(spaces) + line)
    .join("\n");
  const expected: SemanticRoot = {
    type: "root",
    range: range(0, source.length),
    children: [
      {
        type: "quote",
        range: range(0, source.length),
        children: [
          {
            type: "code",
            range: range(2, source.length),
            fence: "indented",
            value,
            language: null,
            meta: null,
          },
        ],
      },
    ],
  };
  checkDocument(source, expected, math);
}

function registerQuotedCodePadding(eol: string, math: boolean): void {
  for (const [prefix, spaces] of quotedCodePadding) {
    test(
      "quoted code keeps residual visual indentation " + JSON.stringify({ prefix, eol, math }),
      () => checkQuotedCodePadding(prefix, spaces, eol, math),
    );
  }
}

for (const eol of ["\n", "\r\n", "\r"]) {
  for (const math of [false, true]) registerQuotedCodePadding(eol, math);
}
