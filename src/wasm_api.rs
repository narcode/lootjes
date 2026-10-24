//! The bridge between JS and Rust for strings.
//!
//! wasm functions can only take and return numbers. To pass text, both
//! sides share wasm's linear memory (one big byte array):
//!
//!   JS -> Rust:  JS calls `alloc(len)`, writes UTF-8 bytes at that pointer,
//!                calls the function with (ptr, len), then `dealloc(ptr, len)`.
//!   Rust -> JS:  Rust stores the answer in OUT and returns its length
//!                (or -1 on failure); JS reads `len` bytes at `out_ptr()`.
//!
//! Names travel as one string separated by '\n': "Anna\nBram\nDaan\nEva"
//! (the person first, then their picks). Input fields can't hold a newline.

use std::alloc::{Layout, alloc as raw_alloc, dealloc as raw_dealloc};
use std::sync::Mutex;

use crate::ticket::{self, Ticket};

/// The last string Rust handed to JS. Valid until the next call that writes it.
static OUT: Mutex<Vec<u8>> = Mutex::new(Vec::new());

fn layout(len: usize) -> Layout {
    // Allocating 0 bytes is not allowed, so always ask for at least 1.
    Layout::array::<u8>(len.max(1)).unwrap()
}

/// Reserve `len` bytes for JS to write into.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    unsafe { raw_alloc(layout(len)) }
}

/// Give back memory from `alloc`. Must use the same `len`.
#[unsafe(no_mangle)]
pub extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    unsafe { raw_dealloc(ptr, layout(len)) }
}

#[unsafe(no_mangle)]
pub extern "C" fn out_ptr() -> *const u8 {
    OUT.lock().unwrap().as_ptr()
}

/// "Anna\nBram\nDaan\nEva" -> link code. Returns the code length, or -1.
#[unsafe(no_mangle)]
pub extern "C" fn encode_ticket(ptr: *const u8, len: usize) -> i32 {
    let Some(input) = read_str(ptr, len) else { return -1 };
    let mut lines = input.split('\n').map(String::from);
    let Some(name) = lines.next() else { return -1 };
    let ticket = Ticket { name, picks: lines.collect() };
    match ticket::encode(&ticket) {
        Some(code) => write_out(code),
        None => -1,
    }
}

/// Link code -> "Anna\nBram\nDaan\nEva". Returns the text length, or -1.
#[unsafe(no_mangle)]
pub extern "C" fn decode_ticket(ptr: *const u8, len: usize) -> i32 {
    let Some(code) = read_str(ptr, len) else { return -1 };
    match ticket::decode(code) {
        Some(t) => write_out(std::iter::once(t.name).chain(t.picks).collect::<Vec<_>>().join("\n")),
        None => -1,
    }
}

/// Look at bytes JS wrote into our memory as a &str (fails if not UTF-8).
fn read_str<'a>(ptr: *const u8, len: usize) -> Option<&'a str> {
    // SAFETY: JS got `ptr` from `alloc(len)` and wrote `len` bytes there.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    std::str::from_utf8(bytes).ok()
}

fn write_out(s: String) -> i32 {
    let len = s.len() as i32;
    *OUT.lock().unwrap() = s.into_bytes();
    len
}
