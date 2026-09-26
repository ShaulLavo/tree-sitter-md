//! Highlight captures from decoration records: the capture names of the Editor's markdown
//! queries (`markdown-highlights.scm`, `markdown-inline-highlights.scm`), so colours come from the
//! same parse as live preview.

use crate::kinds::*;

pub const TITLE: u32 = 1; // text.title
pub const SPECIAL: u32 = 2; // punctuation.special
pub const LITERAL: u32 = 3; // text.literal
pub const DELIMITER: u32 = 4; // punctuation.delimiter
pub const URI: u32 = 5; // text.uri
pub const REFERENCE: u32 = 6; // text.reference
pub const ESCAPE: u32 = 7; // string.escape
pub const EMPHASIS: u32 = 8; // text.emphasis
pub const STRONG_CAPTURE: u32 = 9; // text.strong

/// `records` are `[start, end, kind, extra]`; appends `[start, end, capture]` triples, sorted.
pub fn captures(text: &[u16], records: &[u32], out: &mut Vec<u32>) {
    let mut caps: Vec<[u32; 3]> = Vec::with_capacity(records.len());
    let at = |i: u32| text.get(i as usize).copied().unwrap_or(0);
    for (n, r) in records.chunks_exact(4).enumerate() {
        let (s, e, kind) = (r[0], r[1], r[2]);
        let mut cap = |a: u32, b: u32, c: u32| {
            if a < b {
                caps.push([a, b, c]);
            }
        };
        match kind {
            H => cap(s, trim_end(text, s, e), TITLE),
            HEADING_MARK | LIST_MARK | QUOTE_MARK | HR => cap(s, e, SPECIAL),
            CODE if r[3] == 0 => cap(s, e, LITERAL),
            INFO => cap(s, e, LITERAL),
            FENCE_MARK => cap(s, e, DELIMITER),
            CSPAN => {
                let mut k = 0;
                while s + k < e && at(s + k) == b'`' as u16 {
                    k += 1;
                }
                cap(s, e, LITERAL);
                cap(s, s + k, DELIMITER);
                cap(e - k.min(e - s), e, DELIMITER);
            }
            EM | STRONG | DEL => {
                let marker = at(s);
                let mut k = 0;
                while s + k < e && at(s + k) == marker && k < 2 {
                    k += 1;
                }
                let k = if kind == EM { 1 } else { k };
                let c = if kind == EM { EMPHASIS } else { STRONG_CAPTURE };
                if kind != DEL {
                    cap(s, e, c);
                }
                cap(s, s + k, DELIMITER);
                cap(e - k, e, DELIMITER);
            }
            A | IMG => link(text, records, n, s, e, &mut caps),
            BR => cap(s, e, ESCAPE),
            _ => {}
        }
    }
    caps.sort_unstable_by_key(|c| (c[0], std::cmp::Reverse(c[1])));
    for c in caps {
        out.extend_from_slice(&c);
    }
}

fn trim_end(text: &[u16], s: u32, mut e: u32) -> u32 {
    while e > s && matches!(text[e as usize - 1], 0x0A | 0x0D) {
        e -= 1;
    }
    e
}

/// A link or image: its text is a reference, the brackets delimiters, a destination a URI.
fn link(text: &[u16], records: &[u32], n: usize, s: u32, e: u32, caps: &mut Vec<[u32; 3]>) {
    let label = records[n * 4 + 4..]
        .chunks_exact(4)
        .take_while(|r| r[0] < e)
        .find(|r| r[2] == LINK_TEXT && r[0] >= s && r[1] <= e);
    let Some(label) = label else {
        caps.push([s, e, URI]);
        return;
    };
    let (a, b) = (label[0], label[1]);
    if text[s as usize] == b'<' as u16 {
        caps.push([s, e, URI]);
        return;
    }
    caps.push([s, a, DELIMITER]);
    caps.push([a, b, REFERENCE]);
    if b < e && text[b as usize] == b']' as u16 {
        caps.push([b, b + 1, DELIMITER]);
    }
    if b + 1 < e && text[b as usize + 1] == b'(' as u16 {
        caps.push([b + 1, b + 2, DELIMITER]);
        caps.push([b + 2, e - 1, URI]);
        caps.push([e - 1, e, DELIMITER]);
    }
}
