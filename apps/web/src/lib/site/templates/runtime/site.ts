interface SearchEntry {
  title?: string;
  description?: string;
  text?: string;
  url?: string;
}

function mountSite() {
  const body = document.body;
  if (document.querySelector(".site-icon")) {
    const reveal = () => document.documentElement.classList.add("site-icons-ready");
    if (document.fonts) {
      void document.fonts
        .load('1em "Material Symbols Rounded"')
        .catch(() => undefined)
        .then(reveal);
    } else {
      reveal();
    }
  }

  const toggle = document.querySelector<HTMLButtonElement>("[data-site-menu]");
  const sidebar = document.getElementById("site-sidebar");
  if (toggle) {
    const menuToggle = toggle;
    const menuIcon = menuToggle.querySelector<HTMLElement>("[data-site-menu-icon]");
    function setMenu(open: boolean) {
      body.classList.toggle("site-nav-open", open);
      menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (menuIcon) menuIcon.textContent = open ? "close" : "menu";
    }
    menuToggle.addEventListener("click", function () {
      setMenu(!body.classList.contains("site-nav-open"));
    });
    document.addEventListener("click", function (event) {
      if (
        !body.classList.contains("site-nav-open") ||
        !(event.target instanceof Node) ||
        !sidebar ||
        sidebar.contains(event.target) ||
        menuToggle.contains(event.target)
      ) {
        return;
      }
      setMenu(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && body.classList.contains("site-nav-open")) setMenu(false);
    });
  }

  function wrapWideMath(): void {
    const page = document.querySelector<HTMLElement>(".site-page");
    if (!page) return;
    for (const math of page.querySelectorAll<HTMLElement>('math:not([display="block"])')) {
      if (math.parentElement?.classList.contains("site-math-inline")) continue;
      const width = math.getBoundingClientRect().width;
      const available = math.parentElement?.clientWidth ?? page.clientWidth;
      if (width <= available + 1) continue;
      const wrapper = document.createElement("span");
      wrapper.className = "site-math-inline";
      math.before(wrapper);
      wrapper.appendChild(math);
    }
  }

  wrapWideMath();
  if (document.fonts) {
    void document.fonts.ready.then(wrapWideMath).catch(() => undefined);
  }
  window.addEventListener("load", wrapWideMath);
  window.addEventListener("resize", wrapWideMath);

  const search = document.getElementById("site-search");
  const results = document.querySelector<HTMLElement>(".site-search__results");
  const searchUrl = body.dataset.search;
  if (!(search instanceof HTMLInputElement) || !results || !searchUrl) return;

  const input = search;
  const panel = results;
  let index: SearchEntry[] | null = null;
  let loading = false;

  function load() {
    if (index || loading) return;
    loading = true;
    void fetch(searchUrl as string, { credentials: "same-origin" })
      .then(function (response) {
        return response.ok ? response.json() : [];
      })
      .then(function (data: unknown) {
        index = Array.isArray(data) ? (data as SearchEntry[]) : [];
        render();
      })
      .catch(function () {
        index = [];
      })
      .then(function () {
        loading = false;
      });
  }

  function render() {
    const query = input.value.trim().toLowerCase();
    panel.replaceChildren();
    if (query.length < 2) {
      panel.hidden = true;
      return;
    }
    load();
    const source = index || [];
    const hits = source
      .filter(function (entry) {
        return `${entry.title ?? ""} ${entry.description ?? ""} ${entry.text ?? ""}`
          .toLowerCase()
          .includes(query);
      })
      .slice(0, 20);
    if (!hits.length) {
      const empty = document.createElement("p");
      empty.textContent = "No matches";
      panel.appendChild(empty);
    }
    hits.forEach(function (entry) {
      const link = document.createElement("a");
      link.href = (body.dataset.root || "./") + String(entry.url || "/").replace(/^\//, "");
      link.textContent = entry.title || entry.url || "";
      panel.appendChild(link);
    });
    panel.hidden = false;
  }

  input.addEventListener("input", render);
  input.addEventListener("focus", load);
  document.addEventListener("click", function (event) {
    if (event.target instanceof Node && !panel.contains(event.target) && event.target !== input) {
      panel.hidden = true;
    }
  });
  input.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      input.value = "";
      panel.hidden = true;
      input.blur();
    }
  });
}

mountSite();
