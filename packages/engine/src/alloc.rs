//! A global allocator wrapper that records allocation failure.
//!
//! On wasm32 a failed allocation goes straight to `rust_oom`, which aborts the
//! instance without unwinding and never runs the panic hook. JS only sees a
//! bare `unreachable` trap, so without this flag the app cannot tell "out of
//! memory" from a normal panic, and cannot decide whether rebuilding the state
//! is worth a try.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, Ordering};

/// Set when the system allocator returned null. Drained by [`take_oom`].
static OOM: AtomicBool = AtomicBool::new(false);

/// Wrapper over the system allocator that notes failed allocations.
pub struct RecordingAlloc;

unsafe impl GlobalAlloc for RecordingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc(layout) };
        if pointer.is_null() {
            OOM.store(true, Ordering::SeqCst);
        }

        pointer
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc_zeroed(layout) };
        if pointer.is_null() {
            OOM.store(true, Ordering::SeqCst);
        }

        pointer
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let new_pointer = unsafe { System.realloc(pointer, layout, new_size) };
        if new_pointer.is_null() {
            OOM.store(true, Ordering::SeqCst);
        }

        new_pointer
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) };
    }
}

/// Drains the allocation-failure flag. True when the last allocation failed.
pub fn take_oom() -> bool {
    OOM.swap(false, Ordering::SeqCst)
}
