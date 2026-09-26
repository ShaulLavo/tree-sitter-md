//! Link reference definitions: document-global, first definition wins.

use std::collections::HashMap;

#[derive(Clone, PartialEq, Debug)]
pub struct Def {
    pub dest: String,
    pub title: String,
}

/// The definitions found in one paragraph, keyed by where that paragraph starts.
pub struct DefSource {
    pub start: u32,
    pub end: u32,
    pub defs: Vec<(String, Def)>,
}

#[derive(Default)]
pub struct Defs {
    pub map: HashMap<String, Def>,
    /// Sorted by `start`; the map is rebuilt from these in document order.
    pub sources: Vec<DefSource>,
}

impl Defs {
    pub fn clear(&mut self) {
        self.map.clear();
        self.sources.clear();
    }

    pub fn get(&self, label: &str) -> Option<&Def> {
        self.map.get(label)
    }

    /// Shift sources after an edit and drop those that intersect `[from, to)` in the new text.
    pub fn apply_edit(&mut self, start: u32, old_end: u32, new_end: u32) {
        let delta = new_end as i64 - old_end as i64;
        self.sources.retain_mut(|s| {
            if s.end < start {
                return true;
            }
            if s.start > old_end {
                s.start = (s.start as i64 + delta) as u32;
                s.end = (s.end as i64 + delta) as u32;
                return true;
            }
            false
        });
    }

    pub fn remove_overlapping(&mut self, from: u32, to: u32) {
        self.sources.retain(|s| s.end < from || s.start > to);
    }

    pub fn insert_source(&mut self, source: DefSource) {
        let at = self.sources.partition_point(|s| s.start < source.start);
        if self.sources.get(at).is_some_and(|s| s.start == source.start) {
            self.sources[at] = source;
            return;
        }
        self.sources.insert(at, source);
    }

    /// Rebuild the map; returns the labels whose definition changed.
    pub fn rebuild(&mut self) -> Vec<String> {
        let mut next: HashMap<String, Def> = HashMap::with_capacity(self.map.len());
        for source in &self.sources {
            for (label, def) in &source.defs {
                next.entry(label.clone()).or_insert_with(|| def.clone());
            }
        }
        let mut changed = Vec::new();
        for (label, def) in &next {
            if self.map.get(label) != Some(def) {
                changed.push(label.clone());
            }
        }
        for label in self.map.keys() {
            if !next.contains_key(label) {
                changed.push(label.clone());
            }
        }
        self.map = next;
        changed
    }
}

/// CommonMark label matching: trim, collapse whitespace, Unicode case fold. Same steps as
/// micromark's `normalizeIdentifier`.
pub fn normalize_label(label: &str) -> String {
    let mut out = String::with_capacity(label.len());
    let mut pending_space = false;
    for c in label.chars() {
        if matches!(c, ' ' | '\t' | '\n' | '\r') {
            pending_space = !out.is_empty();
            continue;
        }
        if pending_space {
            out.push(' ');
            pending_space = false;
        }
        for lower in c.to_lowercase() {
            out.extend(lower.to_uppercase());
        }
    }
    out
}
