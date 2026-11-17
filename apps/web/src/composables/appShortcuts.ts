import { isTauri } from "@typbase/storage";

import { isTypingTarget, matchesShortcut } from "~/lib/keybindings";

import type { NavHistory } from "./navHistory";

export interface AppShortcutOptions {
  togglePalette: () => void;
  nav: NavHistory;
  toggleAppBar: () => void;
  isDesktop: Ref<boolean>;
  navOpen: Ref<boolean>;
  toggleSidebar: () => void;
  zen: Ref<boolean>;
  setZen: (value: boolean) => void;
  openFiles: () => void;
  openShortcuts: () => void;
  openSettings: () => void;
  openToday: () => void;
}

/**
 * The app-level chords in `lib/keybindings.ts`. Editor chords stay in
 * `@typbase/codemirror`; these are the ones that belong to the shell.
 */
export function useAppShortcuts(options: AppShortcutOptions): void {
  // Cmd-K / Ctrl-K opens the search palette.
  onCapturedKey(
    (event) => matchesShortcut(event, "search"),
    (event) => {
      event.preventDefault();
      options.togglePalette();
    },
  );

  /**
   * Back and forward, on the chords browsers and editors use. The desktop shell
   * has no browser to do it, and in a browser tab Alt-ArrowLeft is the browser's
   * own back, which would navigate twice. The chord specs live in
   * `lib/keybindings.ts`; the platform split is part of `matchesShortcut`.
   */
  for (const direction of ["back", "forward"] as const) {
    onCapturedKey(
      (event) => isTauri() && matchesShortcut(event, direction),
      (event) => {
        // The settings fields and the plugin studio install CodeMirror's default
        // keymap, where these arrows walk the syntax tree and the brackets
        // reindent. The capture phase gets here first, so the carve-out has to.
        if ((event.target as HTMLElement | null)?.closest(".cm-editor")) return;

        event.preventDefault();
        if (direction === "back") options.nav.goBack();
        else options.nav.goForward();
      },
    );
  }

  // Cmd-J / Ctrl-J hides the app bar for the editor's full height.
  onCapturedKey(
    (event) => matchesShortcut(event, "appBar"),
    (event) => {
      event.preventDefault();
      options.toggleAppBar();
    },
  );

  // Cmd-\ / Ctrl-\ toggles the sidebar on desktop and the drawer on mobile.
  onCapturedKey(
    (event) => matchesShortcut(event, "sidebar"),
    (event) => {
      event.preventDefault();
      if (options.isDesktop.value) options.toggleSidebar();
      else options.navOpen.value = !options.navOpen.value;
    },
  );

  // Cmd-Alt-Z / Ctrl-Alt-Z toggles focus mode.
  onCapturedKey(
    (event) => matchesShortcut(event, "focus"),
    (event) => {
      event.preventDefault();
      options.setZen(!options.zen.value);
    },
  );

  // Cmd-Shift-E / Ctrl-Shift-E opens the storage browser.
  onCapturedKey(
    (event) => matchesShortcut(event, "files"),
    (event) => {
      event.preventDefault();
      options.openFiles();
    },
  );

  // `?` opens this list, but only when no text field or editor has focus.
  onCapturedKey(
    (event) => matchesShortcut(event, "shortcuts") && !isTypingTarget(event.target),
    (event) => {
      event.preventDefault();
      options.openShortcuts();
    },
  );

  // Cmd-, / Ctrl-, opens workspace settings.
  onCapturedKey(
    (event) => matchesShortcut(event, "settings"),
    (event) => {
      event.preventDefault();
      options.openSettings();
    },
  );

  // Cmd-Alt-T / Ctrl-Alt-T opens (or creates) today's daily note.
  onCapturedKey(
    (event) => matchesShortcut(event, "today"),
    (event) => {
      event.preventDefault();
      options.openToday();
    },
  );
}
