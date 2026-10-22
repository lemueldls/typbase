import { isMac } from "~/lib/platform";

/**
 * One chord, with a macOS variant when the Mac convention differs. Letters use
 * the physical key (`event.code`), so a chord keeps working on non-Latin
 * layouts.
 */
export interface ShortcutKeys {
  default: string;
  mac?: string;
}

export interface KeyboardShortcut {
  id: string;
  group: "application" | "editor";
  keys: ShortcutKeys;
  /** i18n key for the action's name. */
  labelKey: string;
}

/**
 * App-level chords. These are registered through `matchesShortcut` in the
 * components that own the action, so this list is the one place to change a
 * binding and the shortcuts dialog reads it directly. Editor chords live in
 * `packages/codemirror/src/keymap.ts` and the vim package; the editor entries
 * here mirror that keymap for the help dialog.
 */
export const APPLICATION_SHORTCUTS: KeyboardShortcut[] = [
  { id: "search", group: "application", keys: { default: "Mod+K" }, labelKey: "nav.search" },
  { id: "save", group: "application", keys: { default: "Mod+S" }, labelKey: "shortcuts.savePage" },
  {
    id: "export",
    group: "application",
    keys: { default: "Mod+P" },
    labelKey: "exportPage.title",
  },
  {
    id: "appBar",
    group: "application",
    keys: { default: "Mod+J" },
    labelKey: "shortcuts.toggleAppBar",
  },
  {
    id: "sidebar",
    group: "application",
    keys: { default: "Mod+\\" },
    labelKey: "shortcuts.toggleSidebar",
  },
  {
    id: "focus",
    group: "application",
    keys: { default: "Mod+Alt+Z" },
    labelKey: "shortcuts.toggleFocus",
  },
  {
    id: "files",
    group: "application",
    keys: { default: "Mod+Shift+E" },
    labelKey: "explorer.title",
  },
  {
    id: "back",
    group: "application",
    keys: { default: "Alt+ArrowLeft", mac: "Mod+BracketLeft" },
    labelKey: "nav.back",
  },
  {
    id: "forward",
    group: "application",
    keys: { default: "Alt+ArrowRight", mac: "Mod+BracketRight" },
    labelKey: "nav.forward",
  },
  { id: "shortcuts", group: "application", keys: { default: "?" }, labelKey: "shortcuts.open" },
];

export const EDITOR_SHORTCUTS: KeyboardShortcut[] = [
  { id: "undo", group: "editor", keys: { default: "Mod+Z" }, labelKey: "shortcuts.undo" },
  {
    id: "redo",
    group: "editor",
    keys: { default: "Mod+Shift+Z" },
    labelKey: "shortcuts.redo",
  },
  { id: "bold", group: "editor", keys: { default: "Mod+B" }, labelKey: "formatting.bold" },
  { id: "italic", group: "editor", keys: { default: "Mod+I" }, labelKey: "formatting.italic" },
  {
    id: "underline",
    group: "editor",
    keys: { default: "Mod+U" },
    labelKey: "formatting.underline",
  },
  { id: "comment", group: "editor", keys: { default: "Mod+/" }, labelKey: "shortcuts.comment" },
  { id: "find", group: "editor", keys: { default: "Mod+F" }, labelKey: "shortcuts.find" },
  { id: "goto", group: "editor", keys: { default: "Mod+G" }, labelKey: "shortcuts.goto" },
  { id: "nextMatch", group: "editor", keys: { default: "F3" }, labelKey: "shortcuts.nextMatch" },
  {
    id: "selectNext",
    group: "editor",
    keys: { default: "Mod+D" },
    labelKey: "shortcuts.selectNext",
  },
  {
    id: "moveLineUp",
    group: "editor",
    keys: { default: "Alt+ArrowUp" },
    labelKey: "shortcuts.moveLineUp",
  },
  {
    id: "moveLineDown",
    group: "editor",
    keys: { default: "Alt+ArrowDown" },
    labelKey: "shortcuts.moveLineDown",
  },
  {
    id: "blankLine",
    group: "editor",
    keys: { default: "Mod+Enter" },
    labelKey: "shortcuts.blankLine",
  },
  {
    id: "nextDiagnostic",
    group: "editor",
    keys: { default: "F8" },
    labelKey: "shortcuts.nextDiagnostic",
  },
];

const byId = new Map(
  [...APPLICATION_SHORTCUTS, ...EDITOR_SHORTCUTS].map((shortcut) => [shortcut.id, shortcut]),
);

const MAC_MODIFIERS: Record<string, string> = {
  Mod: "⌘",
  Alt: "⌥",
  Shift: "⇧",
  Ctrl: "⌃",
};

const PC_MODIFIERS: Record<string, string> = {
  Mod: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
  Ctrl: "Ctrl",
};

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Enter: "↵",
  BracketLeft: "[",
  BracketRight: "]",
};

/** The platform's chord, formatted for the dialog (`⌘⇧E` or `Ctrl+Shift+E`). */
export function formatShortcut(shortcut: KeyboardShortcut): string {
  const mac = isMac();
  const spec = mac ? (shortcut.keys.mac ?? shortcut.keys.default) : shortcut.keys.default;
  const parts = spec.split("+");
  const key = parts.pop() ?? "";
  const label = KEY_LABELS[key] ?? key;

  if (mac) {
    return [...parts.map((part) => MAC_MODIFIERS[part] ?? part), label].join("");
  }

  return [...parts.map((part) => PC_MODIFIERS[part] ?? part), label].join("+");
}

/** Whether a keydown is the chord registered under `id`. */
export function matchesShortcut(event: KeyboardEvent, id: string): boolean {
  const shortcut = byId.get(id);
  if (!shortcut) return false;

  const spec = isMac() ? (shortcut.keys.mac ?? shortcut.keys.default) : shortcut.keys.default;

  return matchesKeys(event, spec);
}

function matchesKeys(event: KeyboardEvent, spec: string): boolean {
  const parts = spec.split("+");
  const key = parts.pop() ?? "";
  const mac = isMac();
  const mod = mac ? event.metaKey : event.ctrlKey;

  if (parts.includes("Mod") !== mod) return false;
  if (parts.includes("Alt") !== event.altKey) return false;
  // `?` is Shift+/ on most layouts, unshifted on a few. Its key already says
  // what it is, so the modifier check should not reject either form.
  if (key !== "?" && parts.includes("Shift") !== event.shiftKey) return false;
  // Reject the other platform's primary modifier so Ctrl+K does not fire on Mac.
  if (mac ? event.ctrlKey : event.metaKey) return false;

  return keyMatches(event, key);
}

function keyMatches(event: KeyboardEvent, key: string): boolean {
  if (key === "?") return event.key === "?";
  if (key === "/") return event.key === "/" || event.code === "Slash";
  if (key === "\\") return event.key === "\\" || event.code === "Backslash";
  if (/^[A-Za-z]$/.test(key)) {
    return (
      event.code === `Key${key.toUpperCase()}` || event.key.toLowerCase() === key.toLowerCase()
    );
  }
  if (key === "BracketLeft" || key === "BracketRight") return event.code === key;

  return event.key === key;
}

/**
 * Whether a key event started in a text field. The `?` help chord has to stay
 * out of the way while the user is typing, including in the editor.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element?.closest) return false;

  return Boolean(element.closest("input, textarea, select, [contenteditable='true'], .cm-editor"));
}
