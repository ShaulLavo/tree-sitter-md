import assert from "node:assert/strict";
import { test } from "node:test";
import { init, MarkdownDocument } from "../js/index.js";
import type { SemanticRoot, SemanticTableCell, SemanticTableRow } from "../js/semantic.js";

await init();

const range = (start: number, end: number) => ({ start, end });
const text = (value: string, start: number, end: number) =>
  ({
    type: "text",
    range: range(start, end),
    value,
  }) satisfies SemanticTableCell["children"][number];
const cell = (
  value: string,
  start: number,
  end: number,
  textStart: number,
  textEnd: number,
): SemanticTableCell => ({
  type: "tableCell",
  range: range(start, end),
  children: [text(value, textStart, textEnd)],
});
const padding: SemanticTableCell = { type: "tableCell", range: null, children: [] };
const row = (
  start: number,
  end: number,
  cells: readonly SemanticTableCell[],
): SemanticTableRow => ({
  type: "tableRow",
  range: range(start, end),
  cells,
});

type Layout = {
  name: string;
  lines: readonly [string, string, string];
  tableStart: number;
  header: SemanticTableRow;
  body: SemanticTableRow;
};

const layouts: readonly Layout[] = [
  {
    name: "independent indented witness",
    lines: ["  | a | b |  ", "  |---|---|", "  | c |"],
    tableStart: 2,
    header: row(2, 13, [cell("a", 2, 6, 4, 5), cell("b", 6, 13, 8, 9)]),
    body: row(2, 7, [cell("c", 2, 7, 4, 5), padding]),
  },
  {
    name: "unindented control",
    lines: ["| a | b |  ", "|---|---|", "| c |"],
    tableStart: 0,
    header: row(0, 11, [cell("a", 0, 4, 2, 3), cell("b", 4, 11, 6, 7)]),
    body: row(0, 5, [cell("c", 0, 5, 2, 3), padding]),
  },
  {
    name: "tab content after authored pipe",
    lines: ["  | a | b |  ", "  |---|---|", "  |\tc |"],
    tableStart: 2,
    header: row(2, 13, [cell("a", 2, 6, 4, 5), cell("b", 6, 13, 8, 9)]),
    body: row(2, 7, [cell("c", 2, 7, 4, 5), padding]),
  },
  {
    name: "optional opening pipe",
    lines: ["  a | b  ", "  ---|---", "  c | d  "],
    tableStart: 2,
    header: row(2, 9, [cell("a", 2, 4, 2, 3), cell("b", 4, 9, 6, 7)]),
    body: row(2, 9, [cell("c", 2, 4, 2, 3), cell("d", 4, 9, 6, 7)]),
  },
  {
    name: "content-leading spaces after authored pipe",
    lines: ["  | a | b |  ", "  |---|---|", "  |   c |  "],
    tableStart: 2,
    header: row(2, 13, [cell("a", 2, 6, 4, 5), cell("b", 6, 13, 8, 9)]),
    body: row(2, 11, [cell("c", 2, 11, 6, 7), padding]),
  },
  {
    name: "optional closing pipe",
    lines: ["  | a | b |  ", "  |---|---|", "  | c  "],
    tableStart: 2,
    header: row(2, 13, [cell("a", 2, 6, 4, 5), cell("b", 6, 13, 8, 9)]),
    body: row(2, 7, [cell("c", 2, 7, 4, 5), padding]),
  },
  {
    name: "UTF-16 content and trailing tab",
    lines: ["  | a | b |  ", "  |---|---|", "  | 😀 |\t"],
    tableStart: 2,
    header: row(2, 13, [cell("a", 2, 6, 4, 5), cell("b", 6, 13, 8, 9)]),
    body: row(2, 9, [cell("😀", 2, 9, 4, 6), padding]),
  },
];

function offsetCell(value: SemanticTableCell, offset: number): SemanticTableCell {
  if (value.range === null) return padding;
  return {
    type: "tableCell",
    range: range(value.range.start + offset, value.range.end + offset),
    children: value.children.map((child) => ({
      ...child,
      range: range(child.range.start + offset, child.range.end + offset),
    })),
  };
}

function expectedRoot(layout: Layout, eol: string): SemanticRoot {
  const bodyStart = layout.lines[0].length + layout.lines[1].length + 2 * eol.length;
  const end = bodyStart + layout.lines[2].length;
  return {
    type: "root",
    range: range(0, end),
    children: [
      {
        type: "table",
        range: range(layout.tableStart, end),
        align: [null, null],
        rows: [
          layout.header,
          row(
            bodyStart + layout.body.range.start,
            bodyStart + layout.body.range.end,
            layout.body.cells.map((value) => offsetCell(value, bodyStart)),
          ),
        ],
      },
    ],
  };
}

function snapshot(document: MarkdownDocument) {
  const { revision, ...exact } = document.semantics();
  const { revision: openRevision, ...open } = document.presentation({ input: "open" });
  const { revision: endedRevision, ...ended } = document.presentation({ input: "ended" });
  assert.equal(openRevision, revision);
  assert.equal(endedRevision, revision);
  return { exact, open, ended };
}

function checkOwnership(
  document: MarkdownDocument,
  source: string,
  expected: SemanticRoot,
  math: boolean,
) {
  const state = snapshot(document);
  assert.deepEqual(state.exact.root, expected);
  assert.deepEqual(state.exact.capabilities, {
    commonmark: true,
    gfm: true,
    math,
    cjk: true,
    footnotes: true,
  });
  assert.equal(state.exact.profile, "gfm-extended");
  for (const result of [state.open, state.ended]) {
    assert.deepEqual(result.root, expected);
    assert.equal(result.source, source);
    assert.deepEqual(result.capabilities, state.exact.capabilities);
    assert.equal(result.profile, state.exact.profile);
    assert.deepEqual(result.provisional, []);
    assert.deepEqual(result.suppressed, []);
    assert.deepEqual(result.references, []);
  }
  assert.equal(state.open.input, "open");
  assert.equal(state.ended.input, "ended");
  return state;
}

function checkLifecycle(layout: Layout, eol: string, math: boolean): void {
  const source = layout.lines.join(eol);
  const expected = expectedRoot(layout, eol);
  const document = new MarkdownDocument({ gfm: true, cjk: true, math });
  const fresh = new MarkdownDocument({ gfm: true, cjk: true, math });
  try {
    document.setText(source);
    const initial = checkOwnership(document, source, expected, math);
    const bodyStart = layout.lines[0].length + layout.lines[1].length + 2 * eol.length;
    document.edit(bodyStart, bodyStart, " ");
    const editedLayout = {
      ...layout,
      lines: [layout.lines[0], layout.lines[1], " " + layout.lines[2]],
    } satisfies Layout;
    const editedSource = editedLayout.lines.join(eol);
    const editedExpected = expectedRoot(
      {
        ...editedLayout,
        body: row(
          layout.body.range.start + 1,
          layout.body.range.end + 1,
          layout.body.cells.map((value) => offsetCell(value, 1)),
        ),
      },
      eol,
    );
    const edited = checkOwnership(document, editedSource, editedExpected, math);
    fresh.setText(editedSource);
    assert.deepEqual(edited, checkOwnership(fresh, editedSource, editedExpected, math));
    document.edit(bodyStart, bodyStart + 1, "");
    assert.deepEqual(checkOwnership(document, source, expected, math), initial);
    fresh.setText(source);
    assert.deepEqual(snapshot(fresh), initial);
    document.reparse();
    assert.deepEqual(checkOwnership(document, source, expected, math), initial);
  } finally {
    document.dispose();
    fresh.dispose();
  }
}

function checkUnindentedControl(eol: string, math: boolean): void {
  const layout = layouts[1];
  const document = new MarkdownDocument({ gfm: true, cjk: true, math });
  try {
    const source = layout.lines.join(eol);
    document.setText(source);
    checkOwnership(document, source, expectedRoot(layout, eol), math);
  } finally {
    document.dispose();
  }
}

function registerControl(eol: string): void {
  for (const math of [false, true]) {
    test("known-good unindented rows and header " + JSON.stringify({ eol, math }), () =>
      checkUnindentedControl(eol, math),
    );
  }
}

for (const eol of ["\n", "\r\n", "\r"]) registerControl(eol);

function registerCase(layout: Layout, eol: string): void {
  for (const math of [false, true]) {
    test(layout.name + " " + JSON.stringify({ eol, math }), () =>
      checkLifecycle(layout, eol, math),
    );
  }
}

for (const layout of layouts) {
  for (const eol of ["\n", "\r\n", "\r"]) registerCase(layout, eol);
}

function checkTabCodeControl(eol: string, math: boolean): void {
  const source = ["  | a | b |  ", "  |---|---|", "\t| c |"].join(eol);
  const bodyStart = 24 + 2 * eol.length;
  const expected: SemanticRoot = {
    type: "root",
    range: range(0, bodyStart + 6),
    children: [
      {
        type: "table",
        range: range(2, bodyStart - eol.length),
        align: [null, null],
        rows: [row(2, 13, [cell("a", 2, 6, 4, 5), cell("b", 6, 13, 8, 9)])],
      },
      {
        type: "code",
        range: range(bodyStart, bodyStart + 6),
        fence: "indented",
        value: "| c |",
        language: null,
        meta: null,
      },
    ],
  };
  const document = new MarkdownDocument({ gfm: true, cjk: true, math });
  try {
    document.setText(source);
    checkOwnership(document, source, expected, math);
  } finally {
    document.dispose();
  }
}

function registerTabControl(eol: string): void {
  for (const math of [false, true]) {
    test("leading tab retains code classification " + JSON.stringify({ eol, math }), () =>
      checkTabCodeControl(eol, math),
    );
  }
}

for (const eol of ["\n", "\r\n", "\r"]) registerTabControl(eol);
