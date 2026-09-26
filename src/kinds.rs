//! Record kinds crossing into JS. Constructs first, then the markers live preview hides.

pub const P: u32 = 1;
pub const H: u32 = 2; // extra: level
pub const HR: u32 = 3;
pub const CODE: u32 = 4; // extra: 1 fenced
pub const BQ: u32 = 5;
pub const LIST: u32 = 6; // extra: 1 ordered
pub const LI: u32 = 7;
pub const TASK: u32 = 8; // extra: 1 checked
pub const HBLOCK: u32 = 9;
pub const DEF: u32 = 10;
pub const TABLE: u32 = 11; // extra: packed alignments
pub const EM: u32 = 12;
pub const STRONG: u32 = 13;
pub const DEL: u32 = 14;
pub const CSPAN: u32 = 15;
pub const A: u32 = 16;
pub const IMG: u32 = 17;
pub const HTAG: u32 = 18;
pub const BR: u32 = 19;
pub const FRONTMATTER: u32 = 20;

pub const HEADING_MARK: u32 = 32;
pub const LIST_MARK: u32 = 33;
pub const QUOTE_MARK: u32 = 34;
pub const FENCE_MARK: u32 = 35;
pub const INFO: u32 = 36;
pub const TASK_MARK: u32 = 37;
pub const TABLE_DELIMITER_ROW: u32 = 38;
pub const LINK_TEXT: u32 = 39;
