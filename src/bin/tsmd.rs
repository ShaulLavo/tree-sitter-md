//! Native driver: `tsmd <file>` prints the decoration records for the whole file.

use std::alloc::{GlobalAlloc, Layout, System};
use std::io::Read;
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};

struct Counting;
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let n = LIVE.fetch_add(l.size(), Relaxed) + l.size();
        PEAK.fetch_max(n, Relaxed);
        unsafe { System.alloc(l) }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        LIVE.fetch_sub(l.size(), Relaxed);
        unsafe { System.dealloc(p, l) }
    }
}
#[global_allocator]
static A: Counting = Counting;
use tree_sitter_md::doc::Document;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut text = String::new();
    if args.len() > 1 {
        text = std::fs::read_to_string(&args[1]).expect("read");
    } else {
        std::io::stdin().read_to_string(&mut text).expect("stdin");
    }
    let utf16: Vec<u16> = text.encode_utf16().collect();
    let mut doc = Document::new(true);
    doc.set_text(&utf16);
    if std::env::var("TREE").is_ok() {
        println!("{}", doc.tree_string());
    }
    if std::env::var("MEM").is_ok() {
        let before = LIVE.load(Relaxed);
        doc.decorations(0, utf16.len() as u32);
        eprintln!("text {} B; live after parse (Rust heap only) {} B; peak {} B; live after decorating all {} B", utf16.len() * 2, before, PEAK.load(Relaxed), LIVE.load(Relaxed));
        return;
    }
    doc.decorations(0, utf16.len() as u32);
    for r in doc.out().chunks(4) {
        let s = String::from_utf16_lossy(&utf16[r[0] as usize..r[1] as usize]);
        println!("{} {}-{} {} {:?}", r[2], r[0], r[1], r[3], s);
    }
}
