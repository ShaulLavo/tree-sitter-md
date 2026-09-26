//! GFM autolink literals (`www.`, `http(s)://`, email), found in text that no other inline
//! construct claimed.
//!
//! Ported from markdown-rs `src/construct/gfm_autolink_literal.rs` (MIT, Titus Wormer), which
//! follows micromark-extension-gfm-autolink-literal and cmark-gfm's `extensions/autolink.c`.
//! markdown-rs runs the www and protocol forms while tokenizing and the email form afterwards
//! over data events; here all three run over the text runs pulldown-cmark leaves, which is the
//! same thing for text outside links, code and HTML.

#[derive(PartialEq)]
enum Kind {
    Whitespace,
    Punctuation,
    Other,
}

fn char_at(bytes: &[u8], index: usize, end: usize) -> Option<(char, usize)> {
    if index >= end {
        return None;
    }
    let s = unsafe { std::str::from_utf8_unchecked(&bytes[index..end]) };
    let c = s.chars().next()?;
    Some((c, c.len_utf8()))
}

fn kind_at(bytes: &[u8], index: usize, end: usize) -> Kind {
    let Some((c, _)) = char_at(bytes, index, end) else {
        return Kind::Whitespace;
    };
    if c.is_whitespace() {
        return Kind::Whitespace;
    }
    if is_punctuation(c) {
        return Kind::Punctuation;
    }
    Kind::Other
}

/// Unicode punctuation and symbols (CommonMark 0.31), approximated by block for non-ASCII.
pub fn is_punctuation(c: char) -> bool {
    if c.is_ascii() {
        return c.is_ascii_punctuation();
    }
    let u = c as u32;
    matches!(u,
        0xA1..=0xA9 | 0xAB..=0xAC | 0xAE..=0xB1 | 0xB4 | 0xB6..=0xB8 | 0xBB | 0xBF | 0xD7 | 0xF7
        | 0x2010..=0x2027 | 0x2030..=0x205E | 0x20A0..=0x20C0 | 0x2100..=0x214F
        | 0x2190..=0x23FF | 0x2500..=0x27BF | 0x2900..=0x2BFF | 0x2E00..=0x2E7F
        | 0x3001..=0x3003 | 0x3008..=0x3011 | 0x3014..=0x301F | 0x30FB
        | 0xFE10..=0xFE19 | 0xFE30..=0xFE6B | 0xFF01..=0xFF0F | 0xFF1A..=0xFF20
        | 0xFF3B..=0xFF40 | 0xFF5B..=0xFF65 | 0x1F000..=0x1FAFF)
}

/// Find autolink literals in `runs` (byte ranges of `text`). Returns byte ranges.
pub fn find(text: &str, runs: &[(usize, usize)], out: &mut Vec<(usize, usize)>) {
    let bytes = text.as_bytes();
    for &(start, end) in runs {
        find_in_run(bytes, start, end, out);
    }
}

fn find_in_run(bytes: &[u8], start: usize, end: usize, out: &mut Vec<(usize, usize)>) {
    let first = out.len();
    let mut index = start;
    while index < end {
        let c = bytes[index];
        let previous = if index == 0 { None } else { Some(bytes[index - 1]) };
        let found = match c {
            b'w' | b'W' if www_before(previous) => www(bytes, index, end),
            b'h' | b'H' if !previous.is_some_and(|p| p.is_ascii_alphabetic()) => protocol(bytes, index, end),
            _ => None,
        };
        if let Some(stop) = found {
            out.push((index, stop));
            index = stop;
            continue;
        }
        index += 1;
    }
    // Emails live in the text between the links found above.
    let mut gaps = Vec::new();
    let mut at = start;
    for &(a, b) in &out[first..] {
        gaps.push((at, a));
        at = b;
    }
    gaps.push((at, end));
    for (a, b) in gaps {
        emails(bytes, a, b, out);
    }
    out[first..].sort_unstable();
}

fn www_before(previous: Option<u8>) -> bool {
    matches!(previous, None | Some(b'\t' | b'\n' | b'\r' | b' ' | b'(' | b'*' | b'_' | b'[' | b']' | b'~'))
}

fn www(bytes: &[u8], start: usize, end: usize) -> Option<usize> {
    if end - start < 5 || !bytes[start..start + 3].eq_ignore_ascii_case(b"www") || bytes[start + 3] != b'.' {
        return None;
    }
    let domain_end = domain(bytes, start, end)?;
    Some(path(bytes, domain_end, end))
}

fn protocol(bytes: &[u8], start: usize, end: usize) -> Option<usize> {
    let mut index = start;
    while index < end && index - start < 5 && bytes[index].is_ascii_alphabetic() {
        index += 1;
    }
    if index >= end || bytes[index] != b':' {
        return None;
    }
    let name = &bytes[start..index];
    if !name.eq_ignore_ascii_case(b"http") && !name.eq_ignore_ascii_case(b"https") {
        return None;
    }
    if index + 3 > end || &bytes[index + 1..index + 3] != b"//" {
        return None;
    }
    let domain_end = domain(bytes, index + 3, end)?;
    Some(path(bytes, domain_end, end))
}

fn domain(bytes: &[u8], start: usize, end: usize) -> Option<usize> {
    let mut index = start;
    let mut seen = false;
    let mut underscore_last = false;
    let mut underscore_previous = false;
    while index < end {
        match bytes[index] {
            b'.' | b'_' => {
                if trail(bytes, index, end) {
                    break;
                }
                if bytes[index] == b'_' {
                    underscore_last = true;
                } else {
                    underscore_previous = underscore_last;
                    underscore_last = false;
                }
                index += 1;
            }
            b'-' => index += 1,
            _ => {
                if kind_at(bytes, index, end) != Kind::Other {
                    break;
                }
                seen = true;
                index += char_at(bytes, index, end).map_or(1, |(_, n)| n);
            }
        }
    }
    if underscore_previous || underscore_last || !seen {
        return None;
    }
    Some(index)
}

fn path(bytes: &[u8], start: usize, end: usize) -> usize {
    let mut index = start;
    let mut open = 0usize;
    let mut close = 0usize;
    while index < end {
        let c = bytes[index];
        match c {
            b'(' => {
                open += 1;
                index += 1;
            }
            b'!' | b'"' | b'&' | b'\'' | b')' | b'*' | b',' | b'.' | b':' | b';' | b'<' | b'?' | b']'
            | b'_' | b'~' => {
                let continues = c == b')' && close < open;
                if trail(bytes, index, end) && !continues {
                    return index;
                }
                if c == b')' {
                    close += 1;
                }
                index += 1;
            }
            _ => {
                if kind_at(bytes, index, end) == Kind::Whitespace {
                    return index;
                }
                index += char_at(bytes, index, end).map_or(1, |(_, n)| n);
            }
        }
    }
    index
}

/// Whether the punctuation at `index` (and any after it) ends the literal.
fn trail(bytes: &[u8], mut index: usize, end: usize) -> bool {
    loop {
        if index >= end {
            return true;
        }
        match bytes[index] {
            b'!' | b'"' | b'\'' | b')' | b'*' | b',' | b'.' | b':' | b';' | b'?' | b'_' | b'~' => index += 1,
            b'&' => {
                index += 1;
                let letters = index;
                while index < end && bytes[index].is_ascii_alphabetic() {
                    index += 1;
                }
                if index == letters || index >= end || bytes[index] != b';' {
                    return false;
                }
                index += 1;
            }
            b'<' => return true,
            b']' => {
                index += 1;
                if index >= end || matches!(bytes[index], b'\t' | b'\n' | b'\r' | b' ' | b'(' | b'[') {
                    return true;
                }
            }
            _ => return kind_at(bytes, index, end) == Kind::Whitespace,
        }
    }
}

fn emails(bytes: &[u8], start: usize, end: usize, out: &mut Vec<(usize, usize)>) {
    let mut min = start;
    let mut index = start;
    while index < end {
        if bytes[index] != b'@' {
            index += 1;
            continue;
        }
        let Some(atext) = atext_start(bytes, min, index) else {
            index += 1;
            continue;
        };
        let (link_start, xmpp) = protocol_before(bytes, min, atext);
        let Some(link_end) = email_domain(bytes, index + 1, end, xmpp) else {
            index += 1;
            continue;
        };
        out.push((link_start, link_end));
        min = link_end;
        index = link_end;
    }
}

fn atext_start(bytes: &[u8], min: usize, end: usize) -> Option<usize> {
    let mut index = end;
    while index > min && matches!(bytes[index - 1], b'+' | b'-' | b'.' | b'0'..=b'9' | b'A'..=b'Z' | b'_' | b'a'..=b'z') {
        index -= 1;
    }
    if index == end || (index > min && bytes[index - 1] == b'/') {
        return None;
    }
    Some(index)
}

fn protocol_before(bytes: &[u8], min: usize, end: usize) -> (usize, bool) {
    if end <= min || bytes[end - 1] != b':' {
        return (end, false);
    }
    let mut index = end - 1;
    while index > min && bytes[index - 1].is_ascii_alphanumeric() {
        index -= 1;
    }
    let name = &bytes[index..end - 1];
    if name.eq_ignore_ascii_case(b"xmpp") {
        return (index, true);
    }
    if name.eq_ignore_ascii_case(b"mailto") {
        return (index, false);
    }
    (end, false)
}

fn email_domain(bytes: &[u8], start: usize, end: usize, xmpp: bool) -> Option<usize> {
    let mut index = start;
    let mut dot = false;
    while index < end {
        match bytes[index] {
            b'-' | b'0'..=b'9' | b'A'..=b'Z' | b'_' | b'a'..=b'z' => {}
            b'/' if xmpp => {}
            b'.' if index + 1 < end && bytes[index + 1].is_ascii_alphanumeric() => dot = true,
            _ => break,
        }
        index += 1;
    }
    if index > start && dot && matches!(bytes[index - 1], b'.' | b'A'..=b'Z' | b'a'..=b'z') {
        return Some(index);
    }
    None
}
