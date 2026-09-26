//! Inline resolution for one leaf block (paragraph, heading, table): CommonMark's delimiter
//! stack (emphasis, rule of three), bracket stack (links and images, precedence, reference
//! fallback), code spans, autolinks, raw HTML, hard breaks and GFM strikethrough.
//!
//! The delimiter and bracket algorithms are pulldown-cmark's (MIT), run over the leaf's own
//! text; the tree-sitter grammar has already decided where the leaf starts and ends. References
//! resolve through a callback against the document-global definition map, and the labels a leaf
//! looked up are returned so the caller can invalidate it when one of them changes.

use crate::autolink;
use crate::defs::{Def, Defs, normalize_label};
use crate::kinds::*;
use pulldown_cmark::{Alignment, BrokenLink, CowStr, Event, LinkType, Options, Parser, Tag, TagEnd};

/// A leaf's text with container prefixes removed, and the way back to document offsets.
#[derive(Default)]
pub struct LeafText {
    pub text: String,
    /// Document offset (UTF-16) of the character that starts at each byte.
    pub starts: Vec<u32>,
    /// Document offset just after the character that ends before each byte.
    pub ends: Vec<u32>,
}

impl LeafText {
    pub fn clear(&mut self) {
        self.text.clear();
        self.starts.clear();
        self.ends.clear();
    }

    pub fn push_char(&mut self, c: char, doc: u32, doc_len: u32) {
        let mut buf = [0u8; 4];
        let encoded = c.encode_utf8(&mut buf);
        for _ in 0..encoded.len() {
            self.starts.push(doc);
            self.ends.push(doc + doc_len);
        }
        self.text.push_str(encoded);
    }

    /// A character that is not in the document (an escape in front of a lazy `===` line).
    pub fn push_virtual(&mut self, c: char, doc: u32) {
        self.starts.push(doc);
        self.ends.push(doc);
        self.text.push(c);
    }

    pub fn finish(&mut self, doc_end: u32) {
        self.starts.push(doc_end);
    }

    fn range(&self, start: usize, end: usize) -> (u32, u32) {
        let a = self.starts[start];
        let b = if end == 0 { a } else { self.ends[end - 1] };
        (a, b.max(a))
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum LeafKind {
    Paragraph,
    SetextContent,
    Atx,
    Table,
}

#[derive(Clone, Copy)]
pub struct Item {
    pub start: u32,
    pub end: u32,
    pub kind: u32,
    pub extra: u32,
}

pub fn options(gfm: bool) -> Options {
    let mut options = Options::ENABLE_FOOTNOTES;
    if gfm {
        options |= Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH;
    }
    options
}

/// Resolve one leaf. Items are in document offsets.
pub fn resolve(
    leaf: &LeafText,
    kind: LeafKind,
    gfm: bool,
    defs: &Defs,
    deps: &mut Vec<String>,
    out: &mut Vec<Item>,
) {
    let callback = |link: BrokenLink<'_>| -> Option<(CowStr<'_>, CowStr<'_>)> {
        let label = normalize_label(&link.reference);
        let found = defs.get(&label).map(|d| (d.dest.clone().into(), d.title.clone().into()));
        deps.push(label);
        found
    };
    let parser = Parser::new_with_broken_link_callback(&leaf.text, options(gfm), Some(callback));
    let mut iter = parser.into_offset_iter();
    let mut links = 0u32;
    let mut code = 0u32;
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut body_start: Option<usize> = None;
    // Link and image text extents (leaf bytes), for live preview to keep the text and hide the rest.
    let mut texts: Vec<(usize, usize)> = Vec::new();
    for (event, mut range) in iter.by_ref() {
        if let Event::Start(Tag::Link { link_type, .. } | Tag::Image { link_type, .. }) = &event {
            // pulldown-cmark ends a collapsed reference (`[foo][]`) before its `[]`.
            let collapsed = matches!(link_type, LinkType::Collapsed | LinkType::CollapsedUnknown);
            if collapsed && leaf.text[range.end..].starts_with("[]") {
                range.end += 2;
            }
        }
        if matches!(event, Event::HardBreak) {
            // Includes the line ending, as micromark's `break` does.
            let rest = &leaf.text.as_bytes()[range.end..];
            range.end += match rest {
                [b'\r', b'\n', ..] => 2,
                [b'\n' | b'\r', ..] => 1,
                _ => 0,
            };
        }
        if body_start.is_none() && matches!(event, Event::Start(_)) {
            body_start = Some(range.start);
        }
        if let Event::End(TagEnd::Link | TagEnd::Image) = event {
            if let Some((a, b)) = texts.pop().filter(|(a, b)| a < b) {
                let (start, end) = leaf.range(a, b);
                out.push(Item { start, end, kind: LINK_TEXT, extra: 0 });
            }
        } else if let Some(top) = texts.last_mut() {
            top.0 = top.0.min(range.start);
            top.1 = top.1.max(range.end);
        }
        if let Event::Start(Tag::Link { .. } | Tag::Image { .. }) = event {
            texts.push((usize::MAX, 0));
        }
        let (start, end) = leaf.range(range.start, range.end);
        let mut push = |kind: u32, extra: u32| out.push(Item { start, end, kind, extra });
        match event {
            Event::Start(tag) => match tag {
                Tag::Paragraph if kind == LeafKind::Paragraph => push(P, 0),
                Tag::Table(aligns) => push(TABLE, pack_aligns(&aligns)),
                Tag::Emphasis => push(EM, 0),
                Tag::Strong => push(STRONG, 0),
                Tag::Strikethrough => push(DEL, 0),
                Tag::Link { .. } => {
                    push(A, 0);
                    links += 1;
                }
                Tag::Image { .. } => {
                    push(IMG, 0);
                    links += 1;
                }
                Tag::CodeBlock(_) | Tag::HtmlBlock => code += 1,
                _ => {}
            },
            Event::End(TagEnd::Link | TagEnd::Image) => links -= 1,
            Event::End(TagEnd::CodeBlock | TagEnd::HtmlBlock) => code -= 1,
            Event::Code(_) => push(CSPAN, 0),
            Event::InlineHtml(_) => push(HTAG, 0),
            Event::HardBreak => push(BR, 0),
            Event::Text(_) if gfm && links == 0 && code == 0 => add_run(&mut runs, range.start, range.end),
            _ => {}
        }
    }
    if gfm && !runs.is_empty() {
        let mut found = Vec::new();
        autolink::find(&leaf.text, &runs, &mut found);
        for (a, b) in found {
            let (start, end) = leaf.range(a, b);
            out.push(Item { start, end, kind: A, extra: 0 });
        }
    }
    let mut spans: Vec<(usize, usize)> = iter.reference_definitions().iter().map(|d| (d.1.span.start, d.1.span.end)).collect();
    spans.sort_unstable();
    // The map keeps one definition per label; a later duplicate is the text between two spans.
    let body = body_start.unwrap_or(leaf.text.len());
    let mut at = 0;
    if spans.is_empty() {
        return;
    }
    for &(a, b) in spans.iter().chain(std::iter::once(&(body, body))) {
        let gap = leaf.text[at.min(a)..a].trim();
        if !gap.is_empty() {
            let offset = leaf.text[at..a].find(gap).unwrap_or(0) + at;
            let (start, end) = leaf.range(offset, offset + gap.len());
            out.push(Item { start, end, kind: DEF, extra: 0 });
        }
        if a == body {
            break;
        }
        let (start, end) = leaf.range(a, b);
        out.push(Item { start, end, kind: DEF, extra: 0 });
        at = b;
    }
}

fn add_run(runs: &mut Vec<(usize, usize)>, start: usize, end: usize) {
    if let Some(last) = runs.last_mut() {
        if last.1 == start {
            last.1 = end;
            return;
        }
    }
    runs.push((start, end));
}

/// The definitions at the start of a paragraph, for the document-global map.
pub fn definitions(leaf: &LeafText, gfm: bool) -> Vec<(String, Def)> {
    let parser = Parser::new_ext(&leaf.text, options(gfm));
    let iter = parser.into_offset_iter();
    let mut defs: Vec<(String, Def, usize)> = iter
        .reference_definitions()
        .iter()
        .map(|(label, def)| {
            let def_value = Def { dest: def.dest.to_string(), title: def.title.as_deref().unwrap_or("").to_string() };
            (normalize_label(label), def_value, def.span.start)
        })
        .collect();
    defs.sort_by_key(|d| d.2);
    defs.into_iter().map(|(l, d, _)| (l, d)).collect()
}

/// Column count in the low byte, then two bits per column: 0 none, 1 left, 2 center, 3 right.
fn pack_aligns(aligns: &[Alignment]) -> u32 {
    let mut packed = aligns.len().min(255) as u32;
    for (i, a) in aligns.iter().take(12).enumerate() {
        let bits = match a {
            Alignment::None => 0,
            Alignment::Left => 1,
            Alignment::Center => 2,
            Alignment::Right => 3,
        };
        packed |= bits << (8 + 2 * i);
    }
    packed
}
