/**
 * A window keydown handled in the capture phase, like the save chord in
 * `app.vue`.
 *
 * VueUse's `onKeyStroke` takes no capture option: it drops it and always listens
 * while bubbling, which is late enough for a CodeMirror keymap to answer first.
 * App-level chords go through this instead, so the editor never swallows one.
 *
 * Note that the capture phase only reorders listeners inside the page. A chord a
 * browser reserves (Ctrl/Cmd-K focuses the omnibox in Chromium and Safari) never
 * reaches it at all, and needs a visible control as its path.
 */
export function onCapturedKey(
  match: (event: KeyboardEvent) => boolean,
  run: (event: KeyboardEvent) => void,
): void {
  useEventListener(
    "keydown",
    (event) => {
      if (!match(event)) return;

      run(event);
    },
    { capture: true },
  );
}
