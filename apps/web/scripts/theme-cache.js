// Keep the keys and the workspace path parse in sync with lib/themes.ts and
// lib/workspaceRoute.ts. This runs before the app bundle on every route.
(() => {
  const root = document.documentElement;
  const GLOBAL_KEY = "typbase:themeCache";
  const PREFIX = `${GLOBAL_KEY}:`;
  const LAST_KEY = "typbase:lastWorkspace";

  /** Workspace named by the path, else the last one opened on this device. */
  function workspaceId() {
    try {
      const match = /^\/w\/([^/]+)\/?$/.exec(location.pathname);
      if (match?.[1]) return decodeURIComponent(match[1]);
    } catch {
      // A malformed path falls back to the last workspace.
    }

    try {
      return localStorage.getItem(LAST_KEY) || "";
    } catch {
      return "";
    }
  }

  try {
    const id = workspaceId();
    let last = "";
    try {
      last = localStorage.getItem(LAST_KEY) || "";
    } catch {
      // The keyed read still works without the last-opened hint.
    }

    const keyed = id ? localStorage.getItem(PREFIX + id) : null;
    // A direct link to another workspace must not paint the last one's theme.
    const raw = keyed || (!id || last === id ? localStorage.getItem(GLOBAL_KEY) : null);
    if (raw) {
      const cached = JSON.parse(raw);
      const vars = cached.vars;
      if (vars) {
        for (const key in vars) root.style.setProperty(key, vars[key]);
        if (vars["--color-backdrop"]) root.style.backgroundColor = vars["--color-backdrop"];
      }
      if (cached.mode) {
        root.dataset.theme = cached.mode;
        root.style.colorScheme = cached.mode;
      }

      return;
    }
  } catch {
    // Fall through to the system preference when the cache is unreadable.
  }

  try {
    const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

    if (dark) {
      root.dataset.theme = "dark";
      root.style.colorScheme = "dark";
    }
    root.style.backgroundColor = dark ? "#0d0e0f" : "#e7eae8";
  } catch {
    // The CSS fallback still supplies the backdrop.
  }
})();
