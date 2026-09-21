use std::sync::Mutex;

/// The most recent panic message, drained by `takePanicGlobal`.
///
/// A panic on wasm32-unknown-unknown aborts the instance (no unwinding), so
/// JS cannot catch it in Rust; it sees a trap at the call boundary. Recording
/// the message here lets the app distinguish "renderer panicked, rebuild the
/// state" from a generic runtime error, and gives it the message to log. The
/// drain is a free function rather than a `TypstState` method because a trap
/// inside a `&mut self` method leaves wasm-bindgen's borrow flag set, and the
/// method form would throw instead of returning the message.
pub static LAST_PANIC: Mutex<Option<String>> = Mutex::new(None);

pub fn set_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let detail = info.to_string();
        let location = info
            .location()
            .map(|location| {
                format!(
                    " at {}:{}:{}",
                    location.file(),
                    location.line(),
                    location.column()
                )
            })
            .unwrap_or_default();

        if let Ok(mut slot) = LAST_PANIC.lock() {
            *slot = Some(format!("{detail}{location}"));
        }

        #[cfg(target_arch = "wasm32")]
        crate::error!("PANIC: {detail}{location}");
        #[cfg(not(target_arch = "wasm32"))]
        eprintln!("PANIC: {detail}{location}");
    }));
}

/// Drains and returns the last panic message, if any.
pub fn take_panic() -> Option<String> {
    LAST_PANIC.lock().ok().and_then(|mut slot| slot.take())
}
