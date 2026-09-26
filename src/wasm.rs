//! C-ABI exports for the JS binding. Offsets are UTF-16 code units; results are `u32` records
//! in the document's output buffer, read by JS through `tsmd_out`.

use crate::doc::Document;

pub struct Handle {
    doc: Document,
    input: Vec<u16>,
}

#[unsafe(no_mangle)]
pub extern "C" fn tsmd_new(gfm: u32) -> *mut Handle {
    Box::into_raw(Box::new(Handle { doc: Document::new(gfm != 0), input: Vec::new() }))
}

/// # Safety
/// `h` must come from `tsmd_new` and not be used afterwards.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn tsmd_free(h: *mut Handle) {
    drop(unsafe { Box::from_raw(h) });
}

fn handle<'a>(h: *mut Handle) -> &'a mut Handle {
    unsafe { &mut *h }
}

/// A buffer of `len` UTF-16 units for the next `set_text` or `edit`.
#[unsafe(no_mangle)]
pub extern "C" fn tsmd_input(h: *mut Handle, len: u32) -> *mut u16 {
    let h = handle(h);
    h.input.clear();
    h.input.resize(len as usize, 0);
    h.input.as_mut_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn tsmd_set_text(h: *mut Handle) {
    let h = handle(h);
    let input = std::mem::take(&mut h.input);
    h.doc.set_text_owned(input);
}

#[unsafe(no_mangle)]
pub extern "C" fn tsmd_edit(h: *mut Handle, start: u32, old_end: u32) {
    let h = handle(h);
    let input = std::mem::take(&mut h.input);
    h.doc.edit(start, old_end, &input);
    h.input = input;
}

#[unsafe(no_mangle)]
pub extern "C" fn tsmd_reparse(h: *mut Handle) {
    handle(h).doc.reparse();
}

#[unsafe(no_mangle)]
pub extern "C" fn tsmd_decorations(h: *mut Handle, from: u32, to: u32) -> u32 {
    let h = handle(h);
    h.doc.decorations(from, to);
    h.doc.out().len() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn tsmd_folds(h: *mut Handle, from: u32, to: u32) -> u32 {
    let h = handle(h);
    h.doc.folds(from, to);
    h.doc.out().len() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn tsmd_injections(h: *mut Handle, from: u32, to: u32) -> u32 {
    let h = handle(h);
    h.doc.injections(from, to);
    h.doc.out().len() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn tsmd_out(h: *mut Handle) -> *const u32 {
    handle(h).doc.out().as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn tsmd_row_start(h: *mut Handle, row: u32) -> u32 {
    handle(h).doc.row_start(row as usize)
}

#[unsafe(no_mangle)]
pub extern "C" fn tsmd_line_count(h: *mut Handle) -> u32 {
    handle(h).doc.line_count() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn tsmd_highlights(h: *mut Handle, from: u32, to: u32) -> u32 {
    let h = handle(h);
    h.doc.highlights(from, to);
    h.doc.out().len() as u32
}
