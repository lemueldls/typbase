/**
 * Ctrl/Cmd+S is captured at the app level so the browser's save dialog never
 * opens, including on routes where no editor is mounted. The open PageView
 * registers a handler that flushes its text and snapshot; without one there
 * is nothing pending to save and the shortcut stays silent.
 */

type SaveHandler = () => Promise<boolean>;

let handler: SaveHandler | undefined;

export function setSaveHandler(next: SaveHandler | undefined): void {
  handler = next;
}

/** Runs the registered save. Undefined when nothing was open to save. */
export function requestSave(): Promise<boolean> | undefined {
  return handler?.();
}
