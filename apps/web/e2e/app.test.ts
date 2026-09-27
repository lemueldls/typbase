import type { NuxtPage } from "@nuxt/test-utils/e2e";

import { createPage, setup, url } from "@nuxt/test-utils/e2e";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Full-app e2e: a real dev server, a real Chromium, a real OPFS workspace.
 * State is created through `window.__typbase.store` (dev-only) instead of the
 * UI, so tests exercise the engine and the editor rather than dialogs.
 */

describe("typbase app", async () => {
  await setup({
    rootDir: fileURLToPath(new URL("../", import.meta.url)),
    dev: true,
    browser: true,
    browserOptions: { type: "chromium" },
    // Own build dir and no lock check, so a running `pnpm dev` does not block
    // the suite and the two servers do not share `.nuxt`.
    nuxtConfig: { buildDir: ".nuxt-e2e" },
    env: { NUXT_IGNORE_LOCK: "1" },
    setupTimeout: 300_000,
  });

  /** First run shows the storage chooser; set the mode before the app boots. */
  async function openApp(page: NuxtPage, path = "/"): Promise<void> {
    await page.addInitScript(() => localStorage.setItem("typbase:storageMode", "opfs"));
    // NuxtPage.goto does not resolve the path; `url()` does.
    await page.goto(url(path), { waitUntil: "load" });

    await page.waitForSelector(".sidebar", { timeout: 180_000 });
    await page.waitForSelector(".cm-editor", { timeout: 180_000 });
    await page.waitForFunction(() => document.fonts.status === "loaded", null, {
      timeout: 60_000,
    });
  }

  async function createTestPage(
    page: NuxtPage,
    input: { title: string; content: string; kind?: "document" | "notebook" },
  ): Promise<string> {
    const id = await page.evaluate(async (pageInput) => {
      const store = window.__typbase.store;
      const meta = await store.createPage(pageInput);

      return meta.id;
    }, input);

    return id;
  }

  async function showPage(page: NuxtPage, id: string, mode: string): Promise<void> {
    await page.evaluate(
      ({ pageId, viewMode }) => {
        window.__typbase.openPage(pageId);
        window.__typbase.setMode(viewMode);
      },
      { pageId: id, viewMode: mode },
    );

    await page.waitForSelector(".cm-editor", { timeout: 120_000 });
  }

  it("boots into a workspace with an editor", async () => {
    const page = await createPage();
    await openApp(page);

    await expect(page.locator(".sidebar").count()).resolves.toBeGreaterThan(0);
    await expect(page.locator(".cm-editor").count()).resolves.toBeGreaterThan(0);
    await page.close();
  });

  it("persists edited text across a reload", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Persistence check",
      content: "= Persistence\n\nfirst draft\n",
    });
    await showPage(page, id, "write");
    await expect(page.title()).resolves.toBe("Persistence check · My workspace");
    // The page's og:title replaces the static app default, not the other way.
    await expect(
      page.locator('head meta[property="og:title"]').getAttribute("content"),
    ).resolves.toBe("Persistence check · My workspace");

    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" second draft");
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__typbase.store.flush());

    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".cm-editor", { timeout: 120_000 });

    const text = await page.evaluate((pageId) => window.__typbase.store.loadPageText(pageId), id);
    expect(text).toContain("second draft");
    await page.close();
  });

  it("writes the current storage layout", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Layout check",
      content: "= Layout\n\nhello\n",
    });
    await showPage(page, id, "write");
    await page.evaluate(() => window.__typbase.store.flush());

    const paths = await page.evaluate(async () => {
      const found: string[] = [];
      // The OPFS backend roots at a `typbase` directory under the origin's
      // OPFS root; the paths below are storage-relative, as the registry sees
      // them.
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("typbase");

      const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
        const entries = (
          dir as unknown as {
            entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
          }
        ).entries();
        for await (const [name, handle] of entries) {
          const path = prefix ? `${prefix}/${name}` : name;
          if (handle.kind === "directory") await walk(handle as FileSystemDirectoryHandle, path);
          else found.push(path);
        }
      };
      await walk(root, "");

      return found;
    });

    expect(paths.some((path) => /^workspaces\/[^/]+\/state\/workspace\.loro$/.test(path))).toBe(
      true,
    );
    expect(paths.some((path) => /^workspaces\/[^/]+\/state\/pages\/[^/]+\.loro$/.test(path))).toBe(
      true,
    );
    expect(paths.some((path) => /^workspaces\/[^/]+\/pages\/layout-check\.typ$/.test(path))).toBe(
      true,
    );
    expect(paths).toContain("layout.json");
    expect(paths.some((path) => path.includes("/sources/"))).toBe(false);
    await page.close();
  });

  it("saves immediately on Ctrl+S with a toast", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Save shortcut",
      content: "= Save\n\nstart\n",
    });
    await showPage(page, id, "write");

    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" typed");

    // The autosave debounce has not fired yet; the shortcut must flush now.
    await page.keyboard.press("Control+s");
    await page.waitForSelector(".ui-toast", { timeout: 10_000 });
    await expect(page.locator(".ui-toast").innerText()).resolves.toContain("Saved");

    const text = await page.evaluate((pageId) => window.__typbase.store.loadPageText(pageId), id);
    expect(text).toContain("typed");
    await page.close();
  });

  it("renders notebook cells and runs one", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Notebook check",
      kind: "notebook",
      content: [
        "// %% [markup]",
        "= Cells",
        "",
        "Prose cell.",
        "",
        "// %% [code]",
        "#let answer = 6 * 7",
        "#answer",
        "",
      ].join("\n"),
    });
    await showPage(page, id, "notebook");

    // Two cell headers and a rendered code output.
    await page.waitForSelector(".tb-cell-header", { timeout: 60_000 });
    expect(await page.locator(".tb-cell-header").count()).toBe(2);
    await page.waitForSelector(".tb-cell-output svg", { timeout: 60_000 });

    // Run the code cell; the counter appears.
    await page.locator(".tb-cell-btn--run").nth(1).click();
    await page.waitForSelector(".tb-cell-counter", { timeout: 60_000 });
    await expect(page.locator(".tb-cell-counter").nth(1).innerText()).resolves.toContain("1");
    await page.close();
  });

  it("offers notebook mode only for notebook pages and converts both ways", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Kind conversion",
      content: "= Document\n",
    });
    await showPage(page, id, "write");

    const notebookTab = page.locator('.page-view__modes button[aria-label="Notebook"]');
    await expect(notebookTab.count()).resolves.toBe(0);

    // Converting the open page adds the tab and carries the mode with it.
    await page.evaluate((pageId) => window.__typbase.store.updatePageKind(pageId, "notebook"), id);
    await page.waitForSelector('.page-view__modes button[aria-label="Notebook"]', {
      timeout: 15_000,
    });
    await page.waitForFunction(() => window.__typbase.mode?.() === "notebook", null, {
      timeout: 15_000,
    });

    // Converting back removes it and returns to write.
    await page.evaluate((pageId) => window.__typbase.store.updatePageKind(pageId, "document"), id);
    await page.waitForFunction(() => window.__typbase.mode?.() === "write", null, {
      timeout: 15_000,
    });
    await expect(notebookTab.count()).resolves.toBe(0);
    await page.close();
  });

  it("anchors rendered frames at their widget top", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Frame anchor",
      content: "- one\n- two\n- three\n- four\n",
    });
    await showPage(page, id, "write");

    await page.waitForFunction(() => document.querySelectorAll(".typst-render").length >= 4, null, {
      timeout: 60_000,
    });

    // An inline SVG sits on the container's text baseline, so a frame shorter
    // than the editor line box (the last list item, typically) would be pushed
    // down and inflate the gap before it. The SVG must be block-level. Each
    // frame also puts its text on the editor's source baseline: the 16.32pt
    // ascender plus the (22.4 - 21.12) / 2 half-leading.
    const data = await page.evaluate(() =>
      [...document.querySelectorAll(".typst-render")].map((widget) => {
        const container = widget.getBoundingClientRect();
        const svg = widget.querySelector("svg")!;
        const group = svg.querySelector("g")?.getAttribute("transform") ?? "";
        const match = group.match(/matrix\(1 0 0 -1 [\d.]+ ([\d.]+)\)/);

        return {
          offset: Math.round((svg.getBoundingClientRect().top - container.top) * 100) / 100,
          baseline: match ? Number(match[1]) : null,
        };
      }),
    );

    expect(data).toHaveLength(4);
    expect(data.every((entry) => entry.offset === 0)).toBe(true);
    for (const entry of data) {
      expect(entry.baseline).not.toBeNull();
      expect(Math.abs(entry.baseline! - 16.96)).toBeLessThan(0.01);
    }

    await page.close();
  });

  it("keeps the cursor when a request resolves under the editor", async () => {
    const page = await createPage();
    await openApp(page);

    const targetId = await createTestPage(page, {
      title: "Linked target",
      content: "= Linked target\n",
    });
    const sourceId = await createTestPage(page, {
      title: "Embed source",
      content: "= Embed source\n\nA paragraph.\n",
    });
    await showPage(page, sourceId, "write");

    // Wait for the page's own compile before counting its widgets.
    await page.waitForFunction(() => document.querySelectorAll(".typst-render").length >= 1, null, {
      timeout: 60_000,
    });

    // Type an embed at the end while the cursor sits in the first block. The
    // compile requests the target's source; resolving it recompiles. The
    // recompile used to dispatch a no-op document replacement, which mapped
    // the selection into the replaced range and dropped it at 0.
    await page.locator(".cm-content").click();
    await page.evaluate((id) => {
      const view = window.__typbase.view!;
      const doc = view.state.doc.toString();

      view.dispatch({
        changes: { from: doc.length, insert: `\n#typbase.embed("${id}")\n` },
        selection: { anchor: 3 },
      });
    }, targetId);

    // The embed's frame only exists after the source request resolves.
    await page.waitForFunction(() => document.querySelectorAll(".typst-render").length >= 2, null, {
      timeout: 60_000,
    });

    const cursor = await page.evaluate(() => window.__typbase.view?.state.selection.main.head);
    expect(cursor).toBe(3);

    await page.close();
  });

  it("keeps the pane stable when a heading shows its source", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Heading stability",
      content: "= Heading\n\nA paragraph.\n",
    });
    await showPage(page, id, "write");

    await page.waitForFunction(() => document.querySelectorAll(".typst-render").length >= 2, null, {
      timeout: 60_000,
    });
    await page.waitForTimeout(800);

    const measure = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".typst-render")].map((widget) => {
          const rect = widget.getBoundingClientRect();

          return {
            top: Math.round(rect.top * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
          };
        }),
      );

    const before = await measure();
    expect(before).toHaveLength(2);
    // The heading fills its editor line box (1.4 x the 32px h1 size).
    expect(Math.abs(before[0]!.height - 44.8)).toBeLessThan(0.1);

    const target = await page.evaluate(() => {
      const widget = document.querySelectorAll(".typst-render")[0]!;
      const rect = widget.getBoundingClientRect();

      return { x: rect.left + 5, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(500);

    const after = await measure();
    // The heading is source now, so only the paragraph widget remains; its
    // top must not move.
    expect(after).toHaveLength(1);
    expect(Math.abs(after[0]!.top - before[1]!.top)).toBeLessThan(0.5);
    await page.close();
  });

  it("reports diagnostics for broken Typst", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Broken check",
      content: "= Broken\n\n#nope()\n",
    });
    await showPage(page, id, "source");

    await page.waitForSelector(".cm-lintRange-error, .cm-lint-marker-error", {
      timeout: 60_000,
    });
    await expect(
      page.locator(".cm-lintRange-error, .cm-lint-marker-error").count(),
    ).resolves.toBeGreaterThan(0);
    await page.close();
  });

  it("recovers from a forced engine trap without a reload", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Recovery check",
      content: "= Recovery\n\nbefore the crash\n",
    });
    await showPage(page, id, "write");

    // Trap the instance directly. The evaluate sees the trap; the editor's
    // next compile is what reports it to the health state.
    await page.evaluate(() => {
      try {
        window.__typbase.crashEngine();
      } catch {
        // expected: the wasm trap surfaces as a thrown RuntimeError
      }
    });

    // Typing forces a compile; the trap lands in the plugin's catch, which
    // reports it. The character must survive the trap (the highlight guard
    // keeps the transaction from aborting), which the degraded check below
    // proves along with the later text.
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" x");

    await page.waitForFunction(() => window.__typbase.engineStatus() === "failed", null, {
      timeout: 60_000,
    });

    // A non-OOM trap fails immediately: the strip and the toast are the notice.
    await expect(page.locator(".page-view__engine").count()).resolves.toBeGreaterThan(0);
    await expect(page.locator(".ui-toast").count()).resolves.toBeGreaterThan(0);

    // The degraded editor highlights from the static scanner, not wasm.
    await page.waitForSelector(".cm-content .typ-heading", { timeout: 60_000 });
    await expect(page.locator(".cm-content .typ-heading").count()).resolves.toBeGreaterThan(0);

    // The editor fell back to source and remounted, so focus it again. Edits
    // still work and still save while the engine is down.
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" still editable");
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__typbase.store.flush());
    const degraded = await page.evaluate(
      (pageId) => window.__typbase.store.loadPageText(pageId),
      id,
    );
    expect(degraded).toContain("still editable");

    // Retry rebuilds the engine and restores the previous mode.
    await page.locator(".page-view__engine button").first().click();
    await page.waitForFunction(() => window.__typbase.engineStatus() === "ok", null, {
      timeout: 120_000,
    });
    await expect(page.locator(".page-view__engine").count()).resolves.toBe(0);
    await page.waitForFunction(() => window.__typbase.mode() === "write", null, {
      timeout: 30_000,
    });

    // A second trap after the rebuild fails again instead of looping.
    await page.evaluate(() => {
      try {
        window.__typbase.crashEngine();
      } catch {
        // expected
      }
    });
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" again");
    await page.waitForFunction(() => window.__typbase.engineStatus() === "failed", null, {
      timeout: 60_000,
    });

    await page.close();
  });

  it("keeps compiling through a rapid un-define loop", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Heap check",
      content: "#let doomed = 0\n\n= Heap\n\n#doomed\n",
    });
    await showPage(page, id, "write");
    await page.locator(".cm-content").click();

    // The original OOM repro: repeatedly remove and re-add the definition, so
    // every edit is a new source hash for the memoized compile.
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press("Control+Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.press("Delete");
      await page.keyboard.type(`#let doomed = ${index}`);
      await page.waitForTimeout(120);
    }

    await expect(page.evaluate(() => window.__typbase.engineStatus())).resolves.toBe("ok");
    // `memoryBytes()` is the wasm linear memory size, which only grows (V8
    // doubles it) and never shrinks, so it is a high-water mark, not live
    // usage. The watchdog evicts at 1 GB to stop the growth there; the loop
    // must not reach the 4 GB ceiling or OOM.
    const memory = await page.evaluate(() => window.__typbase.engineMemory());
    expect(memory).toBeGreaterThan(0);
    expect(memory).toBeLessThan(3_000_000_000);

    // The text still saves and the engine still compiles the final source.
    await page.evaluate(() => window.__typbase.store.flush());
    const text = await page.evaluate((pageId) => window.__typbase.store.loadPageText(pageId), id);
    expect(text).toContain("#let doomed = 11");

    await page.close();
  });

  /** Enables AI and installs a scripted streaming provider. */
  async function installAiStub(page: NuxtPage, replies: string[]): Promise<void> {
    await page.evaluate((scriptedReplies) => {
      const store = window.__typbase.store;
      store.updateSettings({ ai: { ...store.getAiSettings(), enabled: true } });
      let calls = 0;
      (window as unknown as { __aiCalls: number }).__aiCalls = 0;
      window.__typbase.setAiStub({
        async *stream() {
          const text = scriptedReplies[Math.min(calls, scriptedReplies.length - 1)] ?? "= Empty\n";
          calls += 1;
          (window as unknown as { __aiCalls: number }).__aiCalls = calls;
          yield { type: "text", text };
          yield { type: "done", stopReason: null };
        },
      });
    }, replies);
  }

  async function openChatThread(page: NuxtPage, threadId: string): Promise<void> {
    await page.evaluate((id) => window.__typbase.openChat(id), threadId);
    await page.waitForSelector(".chat-pane", { timeout: 60_000 });
  }

  it("streams a chat reply and renders it as Typst", async () => {
    const page = await createPage();
    await openApp(page);
    await installAiStub(page, ["= Chat answer\n\nHello from the *model*.\n"]);

    const threadId = await page.evaluate(() => window.__typbase.newChat());
    await openChatThread(page, threadId);
    await page.evaluate((id) => window.__typbase.sendChat(id, "Say hi"), threadId);

    await page.waitForFunction(
      () =>
        document.querySelector(".chat-message--assistant")?.getAttribute("data-status") ===
        "verified",
      null,
      { timeout: 90_000 },
    );

    const rendered = await page.locator(".chat-message__render").first().innerText();
    expect(rendered).toContain("Chat answer");
    const messages = await page.evaluate((id) => window.__typbase.chatMessages(id), threadId);
    expect(messages.at(-1)?.status).toBe("verified");

    await page.close();
  });

  it("repairs a reply that does not compile", async () => {
    const page = await createPage();
    await openApp(page);
    await installAiStub(page, ["= Broken\n\n#nope()\n", "= Fixed\n\nAll good.\n"]);

    const threadId = await page.evaluate(() => window.__typbase.newChat());
    await openChatThread(page, threadId);
    await page.evaluate((id) => window.__typbase.sendChat(id, "Write something"), threadId);

    await page.waitForFunction(
      () => {
        const rows = [...document.querySelectorAll(".chat-message--assistant")];

        return rows.some((row) => row.querySelector(".chat-message__badge"));
      },
      null,
      { timeout: 90_000 },
    );
    await page.waitForFunction(
      () => {
        const rows = [...document.querySelectorAll(".chat-message--assistant")];

        return rows.at(-1)?.getAttribute("data-status") === "verified";
      },
      null,
      { timeout: 90_000 },
    );

    const calls = await page.evaluate(() => (window as unknown as { __aiCalls: number }).__aiCalls);
    expect(calls).toBe(2);
    const messages = await page.evaluate((id) => window.__typbase.chatMessages(id), threadId);
    expect(messages.some((message) => message.status === "unverified")).toBe(true);
    expect(messages.at(-1)?.status).toBe("verified");

    await page.close();
  });

  it("persists chat threads across a reload", async () => {
    const page = await createPage();
    await openApp(page);
    await installAiStub(page, ["= Persisted\n\nThis survives.\n"]);

    const threadId = await page.evaluate(() => window.__typbase.newChat());
    await page.evaluate((id) => window.__typbase.sendChat(id, "Remember this"), threadId);
    await page.evaluate(() => window.__typbase.store.flush());

    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".sidebar", { timeout: 180_000 });
    await openChatThread(page, threadId);
    await page.waitForFunction(
      () =>
        document.querySelector(".chat-message--assistant")?.getAttribute("data-status") ===
        "verified",
      null,
      { timeout: 60_000 },
    );

    const messages = await page.evaluate((id) => window.__typbase.chatMessages(id), threadId);
    expect(messages.length).toBeGreaterThanOrEqual(2);

    await page.close();
  });

  it("refreshes the category lists after a category is added", async () => {
    const page = await createPage();
    await openApp(page);

    // Open the new-page dialog once so its category list is read and cached.
    await page.locator('.sidebar button[aria-label="New page"]').click();
    await page.waitForSelector(".dialog", { timeout: 30_000 });
    await page.keyboard.press("Escape");
    await page.waitForSelector(".dialog", { state: "detached", timeout: 30_000 });

    // Add a category; the open dialog's own list must show it.
    await page.locator('.sidebar button[aria-label="Categories"]').click();
    await page.waitForSelector(".category-list", { timeout: 30_000 });
    await page.getByPlaceholder("Category name").fill("Research");
    await page.locator(".dialog").getByRole("button", { name: "Add" }).click();
    await page.locator(".category-list__row", { hasText: "Research" }).waitFor({ timeout: 30_000 });

    await page.keyboard.press("Escape");
    await page.waitForSelector(".category-list", { state: "detached", timeout: 30_000 });

    // The new-page dialog reads the same list; it must see the category too.
    await page.locator('.sidebar button[aria-label="New page"]').click();
    await page.waitForSelector(".dialog", { timeout: 30_000 });
    await page.locator(".dialog .ui-select__trigger").nth(1).click();
    await page.locator(".ui-select__item", { hasText: "Research" }).waitFor({ timeout: 30_000 });

    await page.close();
  });

  it("inserts a page link from the toolbar picker", async () => {
    const page = await createPage();
    await openApp(page);

    const targetId = await createTestPage(page, {
      title: "Picker target",
      content: "= Target\n",
    });
    const sourceId = await createTestPage(page, {
      title: "Picker source",
      content: "= Source\n\n",
    });
    await showPage(page, sourceId, "write");

    // The picker is a reka Combobox: the toolbar button opens it, the input
    // inside filters, the option shows the page path, and a click inserts the
    // page link.
    await page.locator('.edit-toolbar button[aria-label="Page link"]').click();
    await page.locator(".combobox__input").fill("Picker target");

    const path = await page.evaluate(
      (id) => window.__typbase.store.getPage(id)?.path ?? "",
      targetId,
    );
    expect(path).toContain(".typ");
    const optionText = await page.locator(".combobox__item").first().innerText();
    expect(optionText).toContain("Picker target");
    expect(optionText).toContain(path);

    await page.locator(".combobox__item").first().click();

    await page.waitForFunction(
      (id) => {
        const view = window.__typbase.view;
        const text = view?.state.doc.toString() ?? "";

        return text.includes(`#typbase.page-link("${id}")`);
      },
      targetId,
      { timeout: 30_000 },
    );
    // Selecting closes the popover; the exit animation delays the unmount.
    await page.waitForSelector(".combobox", { state: "detached", timeout: 30_000 });

    // Reopening starts from a clean search; the previous selection's id must
    // not linger in the input.
    await page.locator('.edit-toolbar button[aria-label="Page link"]').click();
    await page.waitForSelector(".combobox__input", { timeout: 30_000 });
    expect(await page.locator(".combobox__input").inputValue()).toBe("");

    await page.close();
  });

  it("lists a page's backlinks and reveals the linking call", async () => {
    const page = await createPage();
    await openApp(page);

    const targetId = await createTestPage(page, {
      title: "Backlink target",
      content: "= Target\n\nNothing links here yet.\n",
    });
    const sourceId = await createTestPage(page, {
      title: "Backlink source",
      content: `= Source\n\n#typbase.page-link("${targetId}")\n`,
    });

    // The links panel remembers its open state; turn it on before the page
    // mounts so the toggle click is not part of the assertion.
    await page.evaluate(() => localStorage.setItem("typbase:linksPanel", "true"));
    await showPage(page, targetId, "write");

    await page.waitForFunction(
      ({ id, source }) => (window.__typbase.backlinksFor?.(id) ?? []).includes(source),
      { id: targetId, source: sourceId },
      { timeout: 60_000 },
    );

    await page.waitForSelector(".links", { timeout: 30_000 });
    const text = await page.locator(".links__body").innerText();
    expect(text).toContain("Backlink source");
    expect(text).toContain("#typbase.page-link");

    // Clicking the mention jumps to the source page and reveals the call.
    await page.locator(".links__row--mention").first().click();
    await page.waitForFunction((id) => window.__typbase.pageId === id, sourceId, {
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => {
        const view = window.__typbase.view;
        if (!view) return false;

        const start = view.state.doc.toString().indexOf("#typbase.page-link");

        return start >= 0 && view.state.selection.main.from === start;
      },
      null,
      { timeout: 60_000 },
    );

    await page.close();
  });

  it("resolves query-loop links into the graph", async () => {
    const page = await createPage();
    await openApp(page);

    const targetId = await createTestPage(page, {
      title: "Query target",
      content: "= Target\n\nNothing links here yet.\n",
    });
    const sourceId = await createTestPage(page, {
      title: "Query source",
      content:
        `= Source\n\n` +
        `#let target = typbase.query("pages", filter: "by-id/${targetId}")\n` +
        `#typbase.page-link(target.id)\n`,
    });

    // Opening the graph wants its visible pages resolved, and the rendered
    // link becomes an edge like any static one.
    await page.evaluate(() => window.__typbase.openGraph());
    await page.waitForSelector(".graph canvas", { timeout: 60_000 });
    await expect
      .poll(() => page.evaluate(() => window.__typbase.graphStats()?.edges ?? 0), {
        timeout: 90_000,
      })
      .toBeGreaterThanOrEqual(1);

    // The same record answers backlinks.
    await expect
      .poll(() => page.evaluate((id) => window.__typbase.backlinksFor?.(id) ?? [], targetId), {
        timeout: 30_000,
      })
      .toContain(sourceId);

    await page.close();
  });

  it("lists a query-loop backlink in the links panel", async () => {
    const page = await createPage();
    await openApp(page);

    const targetId = await createTestPage(page, {
      title: "Query target",
      content: "= Target\n\nNothing links here yet.\n",
    });
    const sourceId = await createTestPage(page, {
      title: "Query source",
      content:
        `= Source\n\n` +
        `#let target = typbase.query("pages", filter: "by-id/${targetId}")\n` +
        `#typbase.page-link(target.id)\n`,
    });

    // The links panel wants pending dynamic pages resolved while it is open.
    await page.evaluate(() => localStorage.setItem("typbase:linksPanel", "true"));
    await showPage(page, targetId, "write");

    await page.waitForFunction(
      ({ id, source }) => (window.__typbase.backlinksFor?.(id) ?? []).includes(source),
      { id: targetId, source: sourceId },
      { timeout: 90_000 },
    );

    await page.waitForSelector(".links", { timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const text = await page.locator(".links__body").innerText();

          // The mention points at the dynamic call, not a literal target.
          return text.includes("Query source") && text.includes("#typbase.page-link(target.id)");
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    await page.close();
  });

  it("links a daily note to the next day", async () => {
    const page = await createPage();
    await openApp(page);

    const dates = [-1, 0].map((offset) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + offset);

      return date.toISOString().slice(0, 10);
    });
    const previousId = await page.evaluate(
      async (date) => (await window.__typbase.store.createDailyNote(date)).id,
      dates[0],
    );
    const todayId = await page.evaluate(
      async (date) => (await window.__typbase.store.createDailyNote(date)).id,
      dates[1],
    );

    await showPage(page, previousId, "write");

    // The template asks for its neighbors from the live daily list, so the
    // note created first still links forward to the day added later.
    const nextLink = page.locator(`a[href="typbase://page/${todayId}"]`).first();
    await nextLink.waitFor({ timeout: 60_000 });
    await nextLink.click();
    await page.waitForFunction((id) => window.__typbase.pageId === id, todayId, {
      timeout: 60_000,
    });

    // The newest note has no next day yet; a `none` neighbor must render
    // (three frames: heading, previous, next) and must not fail the compile.
    await page.waitForFunction(() => document.querySelectorAll(".typst-render").length >= 3, null, {
      timeout: 60_000,
    });
    await expect(page.locator(".cm-lintRange-error, .cm-lint-marker-error").count()).resolves.toBe(
      0,
    );

    await page.close();
  });

  it("exposes the compile inputs to page sources", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Inputs check",
      content:
        '#assert(sys.inputs.reason == "editor")\n' +
        "#assert(sys.inputs.page != none)\n" +
        "#assert(sys.inputs.workspace != none)\n\nOK\n",
    });
    await showPage(page, id, "write");

    await page.waitForFunction(() => document.querySelectorAll(".typst-render").length >= 1, null, {
      timeout: 60_000,
    });
    await expect(page.locator(".cm-lintRange-error, .cm-lint-marker-error").count()).resolves.toBe(
      0,
    );

    await page.close();
  });

  it("builds a graph with the linked pages as nodes and edges", async () => {
    const page = await createPage();
    await openApp(page);

    const targetId = await createTestPage(page, {
      title: "Graph target",
      content: "= Target\n",
    });
    await createTestPage(page, {
      title: "Graph source",
      content: `= Source\n\n#typbase.embed("${targetId}")\n`,
    });

    await page.evaluate(() => window.__typbase.openGraph());
    await page.waitForSelector(".graph canvas", { timeout: 60_000 });

    await expect
      .poll(() => page.evaluate(() => window.__typbase.graphStats()), { timeout: 60_000 })
      .not.toBeNull();

    const stats = await page.evaluate(() => window.__typbase.graphStats());
    expect(stats?.nodes ?? 0).toBeGreaterThanOrEqual(2);
    expect(stats?.edges ?? 0).toBeGreaterThanOrEqual(1);

    await page.close();
  });

  it("returns to the previous page on back", async () => {
    const page = await createPage();
    await openApp(page);

    const firstId = await createTestPage(page, {
      title: "Back first",
      content: "= First\n",
    });
    const secondId = await createTestPage(page, {
      title: "Back second",
      content: "= Second\n",
    });
    await showPage(page, firstId, "write");

    // The initial entry carries the resolved page, so back has somewhere to go.
    expect(new URL(page.url()).searchParams.get("page")).toBe(firstId);

    await page.evaluate((id) => window.__typbase.openPage(id), secondId);
    await page.waitForFunction((id) => window.__typbase.pageId === id, secondId, {
      timeout: 30_000,
    });

    await page.evaluate(() => window.history.back());
    await page.waitForFunction((id) => window.__typbase.pageId === id, firstId, {
      timeout: 30_000,
    });

    await page.close();
  });

  it("closes an open pane on back", async () => {
    const page = await createPage();
    await openApp(page);

    await page.evaluate(() => window.__typbase.openGraph());
    await page.waitForSelector(".graph canvas", { timeout: 60_000 });

    await page.evaluate(() => window.history.back());
    await page.waitForFunction(() => !window.__typbase.graphStats, null, {
      timeout: 30_000,
    });

    await page.close();
  });

  it("closes a dialog on back", async () => {
    const page = await createPage();
    await openApp(page);

    await page.locator('.sidebar button[aria-label="Categories"]').click();
    await page.waitForSelector(".category-list", { timeout: 30_000 });

    await page.evaluate(() => window.history.back());
    await page.waitForSelector(".category-list", { state: "detached", timeout: 30_000 });

    await page.close();
  });

  it("closes the mobile drawer on back", async () => {
    const page = await createPage();
    await page.setViewportSize({ width: 420, height: 800 });
    await openApp(page);

    await page.locator(".app__nav-toggle").click();
    await page.waitForSelector(".app__nav--open", { timeout: 30_000 });

    await page.evaluate(() => window.history.back());
    await page.waitForFunction(() => document.querySelector(".app__nav--open") === null, null, {
      timeout: 30_000,
    });

    await page.close();
  });

  it("replaces the drawer entry when a page is picked", async () => {
    const page = await createPage();
    await page.setViewportSize({ width: 420, height: 800 });
    await openApp(page);

    const firstId = await createTestPage(page, {
      title: "Drawer first",
      content: "= First\n",
    });
    const secondId = await createTestPage(page, {
      title: "Drawer second",
      content: "= Second\n",
    });
    await showPage(page, firstId, "write");

    await page.locator(".app__nav-toggle").click();
    await page.waitForSelector(".app__nav--open", { timeout: 30_000 });
    await page.locator(".sidebar__row", { hasText: "Drawer second" }).click();
    await page.waitForFunction((id) => window.__typbase.pageId === id, secondId, {
      timeout: 30_000,
    });

    // Back lands on the page before the drawer, not on the drawer itself.
    await page.evaluate(() => window.history.back());
    await page.waitForFunction((id) => window.__typbase.pageId === id, firstId, {
      timeout: 30_000,
    });
    expect(await page.evaluate(() => document.querySelector(".app__nav--open") === null)).toBe(
      true,
    );

    await page.close();
  });

  it("moves an existing page into a category from its row menu", async () => {
    const page = await createPage();
    await openApp(page);

    const categoryId = await page.evaluate(async () => {
      const store = window.__typbase.store as unknown as {
        addCategory(name: string): Promise<{ id: string }>;
      };

      return (await store.addCategory("Research")).id;
    });

    const id = await createTestPage(page, {
      title: "Categorize me",
      content: "= Categorize me\n",
    });
    await showPage(page, id, "write");

    // The row menu's Category submenu moves the page; the sidebar regroups it.
    const row = page.locator(".sidebar__item", { hasText: "Categorize me" });
    await row.hover();
    await row.locator(".sidebar__row-more").click();
    await page.locator(".menu__item", { hasText: "Set category" }).click();
    await page.locator(".menu__item", { hasText: "Research" }).click();

    const research = page.locator(".sidebar__group").filter({ hasText: "Research" });
    await research
      .locator(".sidebar__row", { hasText: "Categorize me" })
      .waitFor({ timeout: 30_000 });

    const assigned = await page.evaluate((pageId) => {
      const meta = window.__typbase.store.getPage(pageId) as
        | { categoryId?: string | null }
        | undefined;

      return meta?.categoryId ?? null;
    }, id);
    expect(assigned).toBe(categoryId);

    // "No category" puts it back under General.
    await row.hover();
    await row.locator(".sidebar__row-more").click();
    await page.locator(".menu__item", { hasText: "Set category" }).click();
    await page.locator(".menu__item", { hasText: "No category" }).click();

    const general = page.locator(".sidebar__group").filter({ hasText: "General" });
    await general
      .locator(".sidebar__row", { hasText: "Categorize me" })
      .waitFor({ timeout: 30_000 });

    await page.close();
  });

  it("boots the shell offline once the worker has cached it", async () => {
    const page = await createPage();
    await openApp(page);

    // The app registers the worker in production only; the suite registers it
    // directly so the offline path runs against the dev server too.
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });

    // Reload so the page is controlled and the runtime cache fills.
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 60_000,
    });
    await page.waitForSelector(".cm-editor", { timeout: 180_000 });
    await page.waitForTimeout(3000);

    // Drop the HTTP cache so only the worker's cache can answer offline.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.clearBrowserCache");

    await page.context().setOffline(true);
    try {
      await page.reload({ waitUntil: "load" });
      await page.waitForSelector(".sidebar", { timeout: 120_000 });
      await page.waitForSelector(".cm-editor", { timeout: 180_000 });
    } finally {
      await page.context().setOffline(false);
    }

    await page.close();
  });
});
