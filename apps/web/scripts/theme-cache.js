(() => {
  const root = document.documentElement;

  try {
    const raw = localStorage.getItem("typbase:themeCache");
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
