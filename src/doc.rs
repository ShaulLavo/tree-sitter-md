//! One document: UTF-16 text, the incremental block tree, the definition map and the per-leaf
//! inline cache. Offsets crossing the API are UTF-16 code units, as in the editor.

use crate::defs::{DefSource, Defs};
use crate::inline::{self, Item, LeafKind, LeafText};
use crate::kinds::*;
use std::collections::HashMap;
use tree_sitter::{InputEdit, Language, Node, Parser, Point, Tree, TreeCursor};

unsafe extern "C" {
    fn tree_sitter_markdown() -> *const ();
}

pub fn language() -> Language {
    let f = unsafe { tree_sitter_language::LanguageFn::from_raw(tree_sitter_markdown) };
    Language::new(f)
}

struct Ids {
    paragraph: u16,
    inline: u16,
    block_continuation: u16,
    atx_heading: u16,
    setext_heading: u16,
    setext_h1: u16,
    pipe_table: u16,
    pipe_table_delimiter_row: u16,
    thematic_break: u16,
    block_quote: u16,
    block_quote_marker: u16,
    list: u16,
    list_item: u16,
    marker_dot: u16,
    marker_paren: u16,
    task_checked: u16,
    task_unchecked: u16,
    fenced_code_block: u16,
    code_fence_content: u16,
    fence_delimiter: u16,
    info_string: u16,
    indented_code_block: u16,
    html_block: u16,
    minus_metadata: u16,
    plus_metadata: u16,
    atx_markers: [u16; 6],
    list_markers: [u16; 5],
}

impl Ids {
    fn new(lang: &Language) -> Self {
        let id = |name: &str| {
            let v = lang.id_for_node_kind(name, true);
            assert!(v != 0, "unknown node kind {name}");
            v
        };
        Ids {
            paragraph: id("paragraph"),
            inline: id("inline"),
            block_continuation: id("block_continuation"),
            atx_heading: id("atx_heading"),
            setext_heading: id("setext_heading"),
            setext_h1: id("setext_h1_underline"),
            pipe_table: id("pipe_table"),
            pipe_table_delimiter_row: id("pipe_table_delimiter_row"),
            thematic_break: id("thematic_break"),
            block_quote: id("block_quote"),
            block_quote_marker: id("block_quote_marker"),
            list: id("list"),
            list_item: id("list_item"),
            marker_dot: id("list_marker_dot"),
            marker_paren: id("list_marker_parenthesis"),
            task_checked: id("task_list_marker_checked"),
            task_unchecked: id("task_list_marker_unchecked"),
            fenced_code_block: id("fenced_code_block"),
            code_fence_content: id("code_fence_content"),
            fence_delimiter: id("fenced_code_block_delimiter"),
            info_string: id("info_string"),
            indented_code_block: id("indented_code_block"),
            html_block: id("html_block"),
            minus_metadata: id("minus_metadata"),
            plus_metadata: id("plus_metadata"),
            atx_markers: [
                id("atx_h1_marker"),
                id("atx_h2_marker"),
                id("atx_h3_marker"),
                id("atx_h4_marker"),
                id("atx_h5_marker"),
                id("atx_h6_marker"),
            ],
            list_markers: [
                id("list_marker_plus"),
                id("list_marker_minus"),
                id("list_marker_star"),
                id("list_marker_dot"),
                id("list_marker_parenthesis"),
            ],
        }
    }
}

struct CacheEntry {
    /// Offsets relative to the leaf's start.
    items: Vec<Item>,
    deps: Vec<String>,
    used: u32,
}

/// Everything the tree walk mutates, split from the tree so the walk can borrow both.
struct Resolver {
    ids: Ids,
    gfm: bool,
    defs: Defs,
    cache: HashMap<u64, CacheEntry>,
    epoch: u32,
    leaf: LeafText,
    scratch: Vec<Item>,
    deps: Vec<String>,
    out: Vec<u32>,
    spare: Vec<u32>,
    pub resolved: u32,
    pub cached: u32,
}

pub struct Document {
    pub text: Vec<u16>,
    lines: Vec<u32>,
    parser: Parser,
    tree: Option<Tree>,
    r: Resolver,
}

#[inline]
fn start(node: &Node) -> u32 {
    (node.start_byte() / 2) as u32
}
#[inline]
fn end(node: &Node) -> u32 {
    (node.end_byte() / 2) as u32
}

impl Document {
    pub fn new(gfm: bool) -> Self {
        let lang = language();
        let mut parser = Parser::new();
        parser.set_language(&lang).expect("language version");
        Document {
            text: Vec::new(),
            lines: vec![0],
            parser,
            tree: None,
            r: Resolver {
                ids: Ids::new(&lang),
                gfm,
                defs: Defs::default(),
                cache: HashMap::new(),
                epoch: 0,
                leaf: LeafText::default(),
                scratch: Vec::new(),
                deps: Vec::new(),
                out: Vec::new(),
                spare: Vec::new(),
                resolved: 0,
                cached: 0,
            },
        }
    }

    pub fn out(&self) -> &[u32] {
        &self.r.out
    }

    pub fn stats(&self) -> (u32, u32, usize, usize) {
        (self.r.resolved, self.r.cached, self.r.cache.len(), self.r.defs.map.len())
    }

    pub fn line_count(&self) -> usize {
        self.lines.len()
    }

    pub fn row_start(&self, row: usize) -> u32 {
        if row >= self.lines.len() {
            return self.text.len() as u32;
        }
        self.lines[row]
    }

    fn rebuild_lines(&mut self) {
        self.lines.clear();
        self.lines.push(0);
        for (i, &c) in self.text.iter().enumerate() {
            if c == b'\n' as u16 {
                self.lines.push(i as u32 + 1);
            }
        }
    }

    fn point(&self, index: u32) -> Point {
        let row = self.lines.partition_point(|&s| s <= index) - 1;
        Point { row, column: ((index - self.lines[row]) * 2) as usize }
    }

    /// Replace the whole text and parse it.
    pub fn set_text(&mut self, text: &[u16]) {
        self.text.clear();
        self.text.extend_from_slice(text);
        self.parse_text();
    }

    /// `set_text` taking the buffer, so a large document is not held twice.
    pub fn set_text_owned(&mut self, text: Vec<u16>) {
        self.text = text;
        self.parse_text();
    }

    fn parse_text(&mut self) {
        self.rebuild_lines();
        self.r.defs.clear();
        self.r.cache.clear();
        self.tree = self.parser.parse_utf16_le(&self.text, None);
        let len = self.text.len() as u32;
        self.scan_definitions(&[(0, len)]);
        self.r.defs.rebuild();
    }

    /// Reparse with nothing changed. After a full parse, the first incremental reparse cannot
    /// reuse blocks whose first token was lexed in another state; doing it once in idle time
    /// keeps that cost off the first keystroke.
    pub fn reparse(&mut self) {
        let Some(old) = self.tree.take() else { return };
        self.tree = self.parser.parse_utf16_le(&self.text, Some(&old));
    }

    /// Replace `[start, old_end)` with `inserted`.
    pub fn edit(&mut self, start: u32, old_end: u32, inserted: &[u16]) {
        let start_point = self.point(start);
        let old_end_point = self.point(old_end);
        self.text.splice(start as usize..old_end as usize, inserted.iter().copied());
        let new_end = start + inserted.len() as u32;
        let delta = new_end as i64 - old_end as i64;
        let a = self.lines.partition_point(|&s| s <= start);
        let b = self.lines.partition_point(|&s| s <= old_end);
        let fresh: Vec<u32> = inserted
            .iter()
            .enumerate()
            .filter(|(_, c)| **c == b'\n' as u16)
            .map(|(i, _)| start + i as u32 + 1)
            .collect();
        for s in &mut self.lines[b..] {
            *s = (*s as i64 + delta) as u32;
        }
        self.lines.splice(a..b, fresh);
        let new_end_point = self.point(new_end);
        let edit = InputEdit {
            start_byte: start as usize * 2,
            old_end_byte: old_end as usize * 2,
            new_end_byte: new_end as usize * 2,
            start_position: start_point,
            old_end_position: old_end_point,
            new_end_position: new_end_point,
        };
        let Some(mut old) = self.tree.take() else {
            self.set_text(&self.text.clone());
            return;
        };
        old.edit(&edit);
        let tree = self.parser.parse_utf16_le(&self.text, Some(&old)).expect("parse");
        let mut ranges: Vec<(u32, u32)> = vec![(start, new_end)];
        for range in old.changed_ranges(&tree) {
            ranges.push(((range.start_byte / 2) as u32, (range.end_byte / 2) as u32));
        }
        self.tree = Some(tree);
        self.r.epoch += 1;
        self.r.defs.apply_edit(start, old_end, new_end);
        for &(from, to) in &ranges {
            self.r.defs.remove_overlapping(from, to);
        }
        self.scan_definitions(&ranges);
        let changed = self.r.defs.rebuild();
        if !changed.is_empty() {
            self.r.cache.retain(|_, e| !e.deps.iter().any(|d| changed.contains(d)));
        }
        self.r.sweep();
    }

    fn scan_definitions(&mut self, ranges: &[(u32, u32)]) {
        let Some(tree) = self.tree.as_ref() else { return };
        for &(from, to) in ranges {
            let mut cursor = tree.walk();
            scan_definitions_in(&mut cursor, &self.text, &mut self.r, from, to);
        }
    }

    /// Decorations for `[from, to)` into `out`: `[start, end, kind, extra]` records.
    pub fn decorations(&mut self, from: u32, to: u32) {
        self.r.out.clear();
        let Some(tree) = self.tree.as_ref() else { return };
        let mut cursor = tree.walk();
        visit(&mut cursor, &self.text, &mut self.r, from, to);
    }

    /// Fold ranges for `[from, to)`: `[start, end]` pairs for multi-line blocks.
    pub fn folds(&mut self, from: u32, to: u32) {
        self.r.out.clear();
        let Some(tree) = self.tree.as_ref() else { return };
        let mut cursor = tree.walk();
        folds(&mut cursor, &self.text, &mut self.r.out, from, to);
    }

    /// Code fence injections for `[from, to)`: `[content_start, content_end, lang_start, lang_end]`,
    /// the language being the info string's first word (empty when there is none).
    pub fn injections(&mut self, from: u32, to: u32) {
        self.r.out.clear();
        let Some(tree) = self.tree.as_ref() else { return };
        let mut cursor = tree.walk();
        injections(&mut cursor, &self.text, &self.r.ids, &mut self.r.out, from, to);
    }

    /// Highlight captures for `[from, to)`: `[start, end, capture]` triples (see `highlight`).
    pub fn highlights(&mut self, from: u32, to: u32) {
        self.decorations(from, to);
        let records = std::mem::take(&mut self.r.out);
        let mut out = std::mem::take(&mut self.r.spare);
        out.clear();
        crate::highlight::captures(&self.text, &records, &mut out);
        self.r.out = out;
        self.r.spare = records;
    }

    pub fn tree_string(&self) -> String {
        self.tree.as_ref().map(|t| t.root_node().to_sexp()).unwrap_or_default()
    }
}

fn first_word(text: &[u16], start: u32, end: u32) -> (u32, u32) {
    let mut a = start;
    while a < end && matches!(text[a as usize], 0x20 | 0x09) {
        a += 1;
    }
    let mut b = a;
    while b < end && !matches!(text[b as usize], 0x20 | 0x09 | 0x0A | 0x0D) {
        b += 1;
    }
    (a, b)
}

impl Resolver {
    fn record(&mut self, start: u32, end: u32, kind: u32, extra: u32) {
        self.out.extend_from_slice(&[start, end, kind, extra]);
    }

    fn sweep(&mut self) {
        if self.cache.len() < 8192 {
            return;
        }
        let keep_after = self.epoch.saturating_sub(256);
        self.cache.retain(|_, e| e.used >= keep_after);
    }

    /// Resolve a leaf through the cache and append its records.
    fn leaf(&mut self, text: &[u16], node: Node, kind: LeafKind) {
        let base = start(&node);
        let key = leaf_key(text, &node, kind, self.ids.block_continuation);
        if let Some(entry) = self.cache.get_mut(&key) {
            entry.used = self.epoch;
            self.cached += 1;
            for it in &entry.items {
                self.out.extend_from_slice(&[it.start + base, it.end + base, it.kind, it.extra]);
            }
            return;
        }
        self.resolved += 1;
        self.scratch.clear();
        self.deps.clear();
        if kind == LeafKind::Table {
            self.table(text, node);
        } else {
            build_leaf(text, &node, kind, &self.ids, &mut self.leaf);
            inline::resolve(&self.leaf, kind, self.gfm, &self.defs, &mut self.deps, &mut self.scratch);
        }
        let mut items = Vec::with_capacity(self.scratch.len());
        for it in &self.scratch {
            self.out.extend_from_slice(&[it.start, it.end, it.kind, it.extra]);
            items.push(Item { start: it.start - base, end: it.end - base, kind: it.kind, extra: it.extra });
        }
        let deps = std::mem::take(&mut self.deps);
        self.cache.insert(key, CacheEntry { items, deps, used: self.epoch });
    }
}

impl Resolver {
    /// A table: alignments from the delimiter row, then each cell as its own one-line leaf.
    /// Cells split on unescaped `|` (inside code spans too, as GFM says); cells past the header's
    /// count still get their inlines, as micromark keeps them.
    fn table(&mut self, text: &[u16], node: Node) {
        let mut cursor = node.walk();
        let rows: Vec<(u16, u32, u32)> = node
            .named_children(&mut cursor)
            .filter(|c| c.kind_id() != self.ids.block_continuation)
            .map(|c| (c.kind_id(), start(&c), end(&c)))
            .collect();
        let mut cells = Vec::new();
        let mut aligns = 0u32;
        let mut columns = 0u32;
        let mut last = start(&node);
        for &(kind, s, e) in &rows {
            cells.clear();
            split_cells(text, s, e, &mut cells);
            last = e;
            if kind == self.ids.pipe_table_delimiter_row {
                columns = cells.len() as u32;
                for (i, &(a, b)) in cells.iter().enumerate().take(12) {
                    let left = text[a as usize] == b':' as u16;
                    let right = b > a && text[b as usize - 1] == b':' as u16;
                    let bits = match (left, right) {
                        (true, true) => 2,
                        (true, false) => 1,
                        (false, true) => 3,
                        (false, false) => 0,
                    };
                    aligns |= bits << (8 + 2 * i);
                }
                continue;
            }
            for &(a, b) in &cells {
                build_single_line(text, a, b, &mut self.leaf);
                inline::resolve(&self.leaf, LeafKind::Atx, self.gfm, &self.defs, &mut self.deps, &mut self.scratch);
            }
        }
        let mut end_at = last;
        while end_at > start(&node) && matches!(text[end_at as usize - 1], 0x0A | 0x0D) {
            end_at -= 1;
        }
        self.scratch.insert(0, Item { start: start(&node), end: end_at, kind: TABLE, extra: columns.min(255) | aligns });
    }
}

/// Cell ranges of one table row, trimmed; the leading and trailing pipes are not cells.
fn split_cells(text: &[u16], s: u32, e: u32, out: &mut Vec<(u32, u32)>) {
    let ws = |c: u16| matches!(c, 0x20 | 0x09 | 0x0A | 0x0D);
    let mut i = s;
    while i < e && ws(text[i as usize]) {
        i += 1;
    }
    if i < e && text[i as usize] == b'|' as u16 {
        i += 1;
    }
    let mut cell = i;
    while i < e {
        let c = text[i as usize];
        if c == b'\\' as u16 {
            i += 2;
            continue;
        }
        if c == b'|' as u16 {
            out.push(trim(text, cell, i));
            cell = i + 1;
        }
        i += 1;
    }
    let tail = trim(text, cell, e.min(text.len() as u32));
    if tail.1 > tail.0 {
        out.push(tail);
    }
}

fn trim(text: &[u16], mut a: u32, mut b: u32) -> (u32, u32) {
    while a < b && matches!(text[a as usize], 0x20 | 0x09 | 0x0A | 0x0D) {
        a += 1;
    }
    while b > a && matches!(text[b as usize - 1], 0x20 | 0x09 | 0x0A | 0x0D) {
        b -= 1;
    }
    (a, b)
}

/// One line of inline content, parsed as a paragraph continuation (see `LeafKind::Atx`).
fn build_single_line(text: &[u16], s: u32, e: u32, leaf: &mut LeafText) {
    leaf.clear();
    leaf.push_virtual('a', s);
    leaf.push_virtual('\n', s);
    let mut first_line = false;
    let mut line_start = true;
    push_lines(text, s, e, leaf, &mut first_line, &mut line_start, true);
    leaf.finish(e);
}

fn leaf_key(text: &[u16], node: &Node, kind: LeafKind, continuation: u16) -> u64 {
    let (s, e) = (start(node) as usize, end(node) as usize);
    let mut h: u64 = 0xcbf29ce484222325 ^ kind as u64;
    let mix = |h: u64, x: u64| (h.rotate_left(5) ^ x).wrapping_mul(0x517cc1b727220a95);
    let slice = &text[s..e];
    let mut chunks = slice.chunks_exact(4);
    for c in &mut chunks {
        let x = c[0] as u64 | (c[1] as u64) << 16 | (c[2] as u64) << 32 | (c[3] as u64) << 48;
        h = mix(h, x);
    }
    for &c in chunks.remainder() {
        h = mix(h, c as u64);
    }
    h = mix(h, slice.len() as u64);
    // Where the container prefixes sit decides what the leaf's text is.
    let mut cursor = node.walk();
    let mut stack = vec![*node];
    while let Some(n) = stack.pop() {
        for child in n.named_children(&mut cursor) {
            if child.kind_id() == continuation {
                h = mix(h, (start(&child) as usize - s) as u64 | ((end(&child) as usize - s) as u64) << 32);
            } else if child.named_child_count() > 0 {
                stack.push(child);
            }
        }
    }
    h
}

/// Append the UTF-16 range `[from, to)` to the leaf. Each continuation line is re-indented by
/// four virtual spaces: the grammar already decided the line continues the paragraph, and an
/// indented line cannot start a block, so the leaf parse cannot read it as one (`***`, `- a`,
/// `===`). Paragraph continuation drops leading whitespace, so inline results do not change.
fn push_lines(text: &[u16], from: u32, to: u32, leaf: &mut LeafText, first_line: &mut bool, line_start: &mut bool, reindent: bool) {
    let mut i = from;
    while i < to {
        let c = text[i as usize];
        if *line_start {
            if c == 0x20 || c == 0x09 {
                i += 1;
                continue;
            }
            *line_start = false;
            if reindent && !*first_line {
                for _ in 0..4 {
                    leaf.push_virtual(' ', i);
                }
            }
        }
        let (ch, len) = decode(text, i as usize, to as usize);
        leaf.push_char(ch, i, len);
        i += len;
        if c == b'\n' as u16 {
            *line_start = true;
            *first_line = false;
        }
    }
}

/// Heading content without surrounding whitespace and the optional closing `#` sequence.
fn atx_content(text: &[u16], s: u32, e: u32) -> (u32, u32) {
    let ws = |c: u16| matches!(c, 0x20 | 0x09 | 0x0A | 0x0D);
    let mut a = s;
    let mut b = e;
    while a < b && ws(text[a as usize]) {
        a += 1;
    }
    while b > a && ws(text[b as usize - 1]) {
        b -= 1;
    }
    let mut h = b;
    while h > a && text[h as usize - 1] == b'#' as u16 {
        h -= 1;
    }
    if h < b && (h == a || matches!(text[h as usize - 1], 0x20 | 0x09)) {
        b = h;
        while b > a && ws(text[b as usize - 1]) {
            b -= 1;
        }
    }
    (a, b)
}

fn decode(text: &[u16], i: usize, end: usize) -> (char, u32) {
    let c = text[i];
    if (0xD800..0xDC00).contains(&c) && i + 1 < end && (0xDC00..0xE000).contains(&text[i + 1]) {
        let v = 0x10000 + (((c as u32) - 0xD800) << 10) + (text[i + 1] as u32 - 0xDC00);
        return (char::from_u32(v).unwrap_or('\u{FFFD}'), 2);
    }
    (char::from_u32(c as u32).unwrap_or('\u{FFFD}'), 1)
}

fn build_leaf(text: &[u16], node: &Node, kind: LeafKind, ids: &Ids, leaf: &mut LeafText) {
    leaf.clear();
    let mut first_line = true;
    let mut line_start = true;
    match kind {
        LeafKind::Paragraph | LeafKind::SetextContent => {
            let mut cursor = node.walk();
            let Some(inline) = node.named_children(&mut cursor).find(|c| c.kind_id() == ids.inline) else {
                leaf.finish(end(node));
                return;
            };
            let mut at = start(&inline);
            let mut c2 = inline.walk();
            for cont in inline.named_children(&mut c2) {
                if cont.kind_id() != ids.block_continuation {
                    continue;
                }
                push_lines(text, at, start(&cont), leaf, &mut first_line, &mut line_start, true);
                at = end(&cont);
            }
            push_lines(text, at, end(&inline), leaf, &mut first_line, &mut line_start, true);
            leaf.finish(end(&inline));
        }
        LeafKind::Atx => {
            let mut cursor = node.walk();
            let Some(inline) = node.named_children(&mut cursor).find(|c| c.kind_id() == ids.inline) else {
                leaf.finish(end(node));
                return;
            };
            let (s, e) = atx_content(text, start(&inline), end(&inline));
            build_single_line(text, s, e, leaf);
        }
        LeafKind::Table => leaf.finish(end(node)),

    }
}

fn leaf_starts_with_bracket(text: &[u16], node: &Node, ids: &Ids) -> bool {
    let mut cursor = node.walk();
    let Some(inline) = node.named_children(&mut cursor).find(|c| c.kind_id() == ids.inline) else {
        return false;
    };
    let mut i = start(&inline) as usize;
    while i < text.len() && matches!(text[i], 0x20 | 0x09) {
        i += 1;
    }
    i < text.len() && text[i] == b'[' as u16
}

fn scan_definitions_in(cursor: &mut TreeCursor, text: &[u16], r: &mut Resolver, from: u32, to: u32) {
    let node = cursor.node();
    let id = node.kind_id();
    if id == r.ids.paragraph {
        if leaf_starts_with_bracket(text, &node, &r.ids) {
            let kind = if node.parent().is_some_and(|p| p.kind_id() == r.ids.setext_heading) {
                LeafKind::SetextContent
            } else {
                LeafKind::Paragraph
            };
            build_leaf(text, &node, kind, &r.ids, &mut r.leaf);
            let defs = inline::definitions(&r.leaf, r.gfm);
            if !defs.is_empty() {
                r.defs.insert_source(DefSource { start: start(&node), end: end(&node), defs });
            }
        }
        return;
    }
    if !has_leaf_children(id, &r.ids) {
        return;
    }
    if cursor.goto_first_child_for_byte(from as usize * 2).is_none() {
        return;
    }
    loop {
        let child = cursor.node();
        if start(&child) > to {
            break;
        }
        scan_definitions_in(cursor, text, r, from, to);
        if !cursor.goto_next_sibling() {
            break;
        }
    }
    cursor.goto_parent();
}

/// Containers that can hold paragraphs.
fn has_leaf_children(id: u16, ids: &Ids) -> bool {
    id != ids.fenced_code_block
        && id != ids.indented_code_block
        && id != ids.html_block
        && id != ids.pipe_table
        && id != ids.atx_heading
        && id != ids.thematic_break
        && id != ids.inline
}

fn visit(cursor: &mut TreeCursor, text: &[u16], r: &mut Resolver, from: u32, to: u32) {
    let node = cursor.node();
    if !emit(&node, text, r) {
        return;
    }
    if cursor.goto_first_child_for_byte(from as usize * 2).is_none() {
        return;
    }
    loop {
        let child = cursor.node();
        if start(&child) >= to && end(&child) > start(&child) {
            break;
        }
        visit(cursor, text, r, from, to);
        if !cursor.goto_next_sibling() {
            break;
        }
    }
    cursor.goto_parent();
}

/// Emit the records for one node; returns whether to descend.
fn emit(node: &Node, text: &[u16], r: &mut Resolver) -> bool {
    let id = node.kind_id();
    let ids = &r.ids;
    let (s, e) = (start(node), end(node));
    if id == ids.paragraph {
        let setext = node.parent().is_some_and(|p| p.kind_id() == r.ids.setext_heading);
        let kind = if setext { LeafKind::SetextContent } else { LeafKind::Paragraph };
        r.leaf(text, *node, kind);
        return false;
    }
    if id == ids.atx_heading {
        let marker = node.named_child(0).map(|m| (m.kind_id(), start(&m), end(&m)));
        let level = marker.and_then(|m| ids.atx_markers.iter().position(|&x| x == m.0)).map_or(1, |l| l + 1);
        r.record(s, e, H, level as u32);
        if let Some((_, ms, me)) = marker {
            r.record(ms, me, HEADING_MARK, level as u32);
        }
        r.leaf(text, *node, LeafKind::Atx);
        return false;
    }
    if id == ids.setext_heading {
        let mut level = 2;
        let mut cursor = node.walk();
        for child in node.named_children(&mut cursor) {
            if child.kind_id() == r.ids.setext_h1 {
                level = 1;
            }
            if child.kind_id() != r.ids.paragraph && child.kind_id() != r.ids.block_continuation {
                r.out.extend_from_slice(&[start(&child), end(&child), HEADING_MARK, level]);
            }
        }
        r.record(s, e, H, level);
        return true;
    }
    if id == ids.pipe_table {
        let mut cursor = node.walk();
        let delimiter = node.named_children(&mut cursor).find(|c| c.kind_id() == r.ids.pipe_table_delimiter_row);
        if let Some(d) = delimiter {
            r.record(start(&d), end(&d), TABLE_DELIMITER_ROW, 0);
        }
        r.leaf(text, *node, LeafKind::Table);
        return false;
    }
    if id == ids.fenced_code_block {
        r.record(s, e, CODE, 1);
        let mut cursor = node.walk();
        let children: Vec<(u16, u32, u32)> =
            node.named_children(&mut cursor).map(|c| (c.kind_id(), start(&c), end(&c))).collect();
        for (kind, cs, ce) in children {
            if kind == r.ids.info_string {
                r.record(cs, ce, INFO, 0);
            } else if kind == r.ids.fence_delimiter {
                r.record(cs, ce, FENCE_MARK, 0);
            }
        }
        return false;
    }
    if id == ids.indented_code_block {
        r.record(s, e, CODE, 0);
        return false;
    }
    if id == ids.html_block {
        r.record(s, e, HBLOCK, 0);
        return false;
    }
    if id == ids.thematic_break {
        r.record(s, e, HR, 0);
        return false;
    }
    if id == ids.minus_metadata || id == ids.plus_metadata {
        r.record(s, e, FRONTMATTER, 0);
        return false;
    }
    if id == ids.block_quote {
        r.record(s, e, BQ, 0);
        return true;
    }
    if id == ids.block_quote_marker {
        r.record(s, e, QUOTE_MARK, 0);
        return false;
    }
    if id == ids.list {
        let marker = node.named_child(0).and_then(|item| item.named_child(0)).map(|m| m.kind_id());
        let ordered = marker.is_some_and(|m| m == r.ids.marker_dot || m == r.ids.marker_paren);
        r.record(s, e, LIST, ordered as u32);
        return true;
    }
    if id == ids.list_item {
        r.record(s, e, LI, 0);
        return true;
    }
    if ids.list_markers.contains(&id) {
        r.record(s, e, LIST_MARK, 0);
        return false;
    }
    if id == ids.task_checked || id == ids.task_unchecked {
        r.record(s, e, TASK, (id == r.ids.task_checked) as u32);
        return false;
    }
    let _ = text;
    true
}

fn folds(cursor: &mut TreeCursor, text: &[u16], out: &mut Vec<u32>, from: u32, to: u32) {
    let node = cursor.node();
    let (s, e) = trim(text, start(&node), end(&node));
    let kind = node.kind();
    let foldable = matches!(kind, "section" | "fenced_code_block" | "block_quote" | "list_item" | "pipe_table" | "html_block");
    if foldable && text[s as usize..e as usize].contains(&(b'\n' as u16)) {
        out.extend_from_slice(&[s, e]);
    }
    if matches!(kind, "paragraph" | "fenced_code_block" | "html_block" | "pipe_table" | "indented_code_block") {
        return;
    }
    if cursor.goto_first_child_for_byte(from as usize * 2).is_none() {
        return;
    }
    loop {
        if start(&cursor.node()) >= to {
            break;
        }
        folds(cursor, text, out, from, to);
        if !cursor.goto_next_sibling() {
            break;
        }
    }
    cursor.goto_parent();
}

fn injections(cursor: &mut TreeCursor, text: &[u16], ids: &Ids, out: &mut Vec<u32>, from: u32, to: u32) {
    let node = cursor.node();
    if node.kind_id() == ids.fenced_code_block {
        let mut c = node.walk();
        let mut lang = (0, 0);
        let mut content = None;
        for child in node.named_children(&mut c) {
            if child.kind_id() == ids.info_string {
                lang = first_word(text, start(&child), end(&child));
            } else if child.kind_id() == ids.code_fence_content {
                content = Some((start(&child), end(&child)));
            }
        }
        if let Some((a, b)) = content {
            out.extend_from_slice(&[a, b, lang.0, lang.1]);
        }
        return;
    }
    if !has_leaf_children(node.kind_id(), ids) {
        return;
    }
    if cursor.goto_first_child_for_byte(from as usize * 2).is_none() {
        return;
    }
    loop {
        if start(&cursor.node()) >= to {
            break;
        }
        injections(cursor, text, ids, out, from, to);
        if !cursor.goto_next_sibling() {
            break;
        }
    }
    cursor.goto_parent();
}
