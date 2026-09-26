//! tree-sitter-md: a tree-sitter block grammar and a CommonMark inline resolver in one module.

pub mod autolink;
pub mod defs;
pub mod doc;
pub mod highlight;
pub mod inline;
pub mod kinds;

#[cfg(target_arch = "wasm32")]
mod wasm;
