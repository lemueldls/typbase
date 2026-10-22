(function () {
  var body = document.body;
  var toggle = document.querySelector("[data-site-menu]");
  if (toggle) {
    toggle.addEventListener("click", function () {
      body.classList.toggle("site-nav-open");
    });
  }
  var input = document.getElementById("site-search");
  var panel = document.querySelector(".site-search__results");
  if (!input || !panel || !body.dataset.search) return;
  var index = null;
  var loading = false;
  function load() {
    if (index || loading) return;
    loading = true;
    void fetch(body.dataset.search, { credentials: "same-origin" })
      .then(function (r) {
        return r.ok ? r.json() : [];
      })
      .then(function (data) {
        index = Array.isArray(data) ? data : [];
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
    var query = input.value.trim().toLowerCase();
    panel.replaceChildren();
    if (query.length < 2) {
      panel.hidden = true;
      return;
    }
    load();
    var source = index || [];
    var hits = source
      .filter(function (entry) {
        return (
          (entry.title + " " + (entry.description || "") + " " + (entry.text || ""))
            .toLowerCase()
            .indexOf(query) !== -1
        );
      })
      .slice(0, 20);
    if (!hits.length) {
      var empty = document.createElement("p");
      empty.textContent = "No matches";
      panel.appendChild(empty);
    }
    hits.forEach(function (entry) {
      var link = document.createElement("a");
      link.href = (body.dataset.root || "./") + String(entry.url || "/").replace(/^\//, "");
      link.textContent = entry.title || entry.url;
      panel.appendChild(link);
    });
    panel.hidden = false;
  }
  input.addEventListener("input", render);
  input.addEventListener("focus", load);
  document.addEventListener("click", function (event) {
    if (!panel.contains(event.target) && event.target !== input) panel.hidden = true;
  });
  input.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      input.value = "";
      panel.hidden = true;
      input.blur();
    }
  });
})();
