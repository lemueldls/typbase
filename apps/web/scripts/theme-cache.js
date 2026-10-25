(() => {
  const root = document.documentElement;

  try {
    const raw = localStorage.getItem("typbase:themeCache");
    if (raw) {
      const cached = JSON.parse(raw);
      const vars = cached.vars;
      if (vars) {
        for (const key in vars) root.style.setProperty(key, vars[key]);
        if (vars["--color-surface"]) root.style.backgroundColor = vars["--color-surface"];
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
    if (!window.matchMedia || !window.matchMedia("(prefers-color-scheme: dark)").matches) return;

    root.dataset.theme = "dark";
    root.style.colorScheme = "dark";
    root.style.backgroundColor = "#1b1d21";
  } catch {
    // Leave the document default if matchMedia is unavailable.
  }
})();
