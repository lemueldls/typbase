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

  /** First run shows the storage chooser, so set the mode before the app boots. */
  async function openApp(page: NuxtPage, path = "/"): Promise<void> {
    await page.addInitScript(() => localStorage.setItem("typbase:storageMode", "opfs"));
    // NuxtPage.goto does not resolve the path. `url()` does.
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

  /** Graph settings persist across the shared context. Local mode from an
   *  earlier test would scope the graph to a single page. */
  async function resetGraphLocal(page: NuxtPage): Promise<void> {
    await page.evaluate(() => {
      window.__typbase.store.updateSettings({ graph: { local: false } });
    });
    await page.waitForTimeout(300);
  }

  /** The app bar ships off, so tests that need it go through Settings. */
  async function enableAppBar(page: NuxtPage): Promise<void> {
    if (await page.locator(".app-bar").count()) return;

    await page.locator(".sidebar__header-actions button").first().click();
    await page.waitForSelector(".settings", { timeout: 30_000 });
    await page.locator(".settings__tab", { hasText: "Appearance" }).click();
    await page.locator(".ui-switch", { hasText: "App bar" }).locator("button").click();
    await page.keyboard.press("Escape");
    await page.waitForSelector(".app-bar", { timeout: 30_000 });
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
      // OPFS root. The paths below are storage-relative, as the registry sees
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

    // The autosave debounce has not fired yet, so the shortcut must flush now.
    await page.keyboard.press("Control+s");
    await page.waitForSelector(".ui-toast", { timeout: 10_000 });
    await expect(page.locator(".ui-toast").innerText()).resolves.toContain("Saved");

    const text = await page.evaluate((pageId) => window.__typbase.store.loadPageText(pageId), id);
    expect(text).toContain("typed");
    await page.close();
  });

  it("splits a notebook into cells at attributes and headings", async () => {
    const page = await createPage();
    await openApp(page);

    // A heading is a boundary on its own, so this is three cells without any
    // attribute lines.
    const id = await createTestPage(page, {
      title: "Cells",
      kind: "notebook",
      content: [
        "//% kind=hidden",
        '#set document(title: "Cells")',
        "",
        "= First heading",
        "",
        "Prose with $x^2$ in it.",
        "",
        "//% kind=code",
        "#let n = 6 * 7",
        "#n",
        "",
      ].join("\n"),
    });
    await showPage(page, id, "write");

    await page.waitForSelector(".tb-cell-rail", { timeout: 60_000 });
    // Three boundaries: the attribute, the heading, and the second attribute.
    expect(await page.locator(".tb-cell-rail").count()).toBe(3);

    // The hidden cell shows neither source nor output, which is the point of it:
    // a directive group should read as quiet, not as a broken code block.
    expect(await page.locator(".cm-content").innerText()).not.toContain("#set document");
    // The code cell keeps its source and renders below it.
    await page.waitForSelector(".tb-cell-output svg", { timeout: 60_000 });
    expect(await page.locator(".tb-cell-output svg").count()).toBeGreaterThan(0);

    await page.close();
  });

  it("renders a notebook differently in each mode", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Modes",
      kind: "notebook",
      content: [
        "//% kind=hidden",
        '#set document(title: "Modes")',
        "",
        "= Heading",
        "",
        "Prose with $x^2$.",
        "",
        "//% kind=code",
        "#let n = 6 * 7",
        "#n",
        "",
      ].join("\n"),
    });
    await showPage(page, id, "write");
    await page.waitForSelector(".tb-cell-rail", { timeout: 60_000 });

    const counts = async () => {
      await page.waitForTimeout(900);

      return page.evaluate(() => ({
        rails: document.querySelectorAll(".tb-cell-rail").length,
        editorFrames: document.querySelectorAll(".typst-render").length,
        previewFrames: document.querySelectorAll(".paged-preview svg").length,
      }));
    };

    // Write mode renders into the editor, inline for prose and below for code.
    const write = await counts();
    expect(write.rails).toBe(3);
    expect(write.editorFrames).toBeGreaterThan(0);
    expect(write.previewFrames).toBe(0);

    // Source mode keeps the cells and the rails but renders nothing, which is the
    // only thing that separates it from write mode. It used to be byte for byte
    // identical, because the pane attached the notebook plugin on `notebook`
    // alone and never asked the mode.
    await page.evaluate(() => window.__typbase.setMode("source"));
    const source = await counts();
    expect(source.rails).toBe(3);
    expect(source.editorFrames).toBe(0);

    // Split mode leaves the frames to the preview pane.
    await page.evaluate(() => window.__typbase.setMode("split"));
    const split = await counts();
    expect(split.rails).toBe(3);
    expect(split.editorFrames).toBe(0);
    expect(split.previewFrames).toBeGreaterThan(0);

    await page.close();
  });

  it("holds a cell's output until it is released", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Held",
      kind: "notebook",
      content: ["//% kind=code", "#let n = 1", "#n", ""].join("\n"),
    });
    await showPage(page, id, "write");
    await page.waitForSelector(".tb-cell-output svg", { timeout: 60_000 });

    // The frame's hash is its render, so an unchanged hash is an output that did
    // not move.
    const hash = (): Promise<string | null> =>
      page.locator(".tb-cell-output .typst-render").first().getAttribute("data-hash");
    const before = await hash();

    await page.locator(".tb-cell-rail button").first().click();
    await page.locator(".menu__item", { hasText: "Hold output" }).click();
    await page.waitForSelector(".tb-cell-held", { timeout: 30_000 });

    // The page is one compile, so holding works by keeping the last render.
    // Editing the source leaves it exactly where it was.
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" + 41");
    await page.waitForTimeout(1200);
    expect(await hash()).toBe(before);

    // Releasing repaints from the current source.
    await page.locator(".tb-cell-rail button").first().click();
    await page.locator(".menu__item", { hasText: "Release output" }).click();
    await expect.poll(hash, { timeout: 30_000 }).not.toBe(before);

    await page.close();
  });

  it("picks a cell's type from the toolbar menu", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Cell types",
      kind: "notebook",
      content: ["//% kind=code", "#let x = 1", "", "//% kind=log", "done", ""].join("\n"),
    });
    await showPage(page, id, "write");
    await page.waitForSelector(".tb-cell-rail", { timeout: 60_000 });

    // The rail labels each cell without offering to toggle it: the four kinds
    // differ in where the output goes, so picking one is a deliberate action.
    const chip = async (index: number): Promise<string> => {
      const text = await page.locator(".tb-cell-chip").nth(index).innerText();

      return (text.split("\n").at(-1) ?? "").trim();
    };
    expect([await chip(0), await chip(1)]).toEqual(["Code", "Log"]);

    // Put the caret in the second cell, then change it from the menu.
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.locator(".notebook-toolbar button[aria-label='Cell type']").click();
    await page.locator(".menu__item", { hasText: "Text" }).click();

    await expect.poll(() => chip(1), { timeout: 30_000 }).toBe("Text");
    // The change is a rewrite of the attribute line, so it is on the undo stack.
    expect(await page.evaluate(() => window.__typbase.view?.state.doc.toString())).toContain("//%");

    await page.close();
  });

  it("gives the active cell's rule a gap and shifts no content", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Active rule",
      kind: "notebook",
      content: ["//% kind=code", "#let n = 6 * 7", "#n", ""].join("\n"),
    });
    await showPage(page, id, "write");
    await page.waitForSelector(".tb-cell-rail", { timeout: 60_000 });

    // Put the caret in the code cell so its line carries the active class.
    await page.locator(".cm-content").click();
    await page.waitForSelector(".cm-line.tb-cell-active", { timeout: 30_000 });
    await page.waitForTimeout(500);

    const measured = await page.evaluate(() => {
      const left = (element: Element | null) =>
        element ? Math.round(element.getBoundingClientRect().left) : null;

      const active = document.querySelector(".cm-line.tb-cell-active");
      // The cell's own text, not the rail's chip: the rail is an inline widget at
      // the start of the line, so the first span on an attribute line belongs to
      // it. `#let n` is the cell's content.
      const lines = [...document.querySelectorAll<HTMLElement>(".cm-line")];
      const codeLine = lines.find((line) => line.innerText.includes("#let n"));
      const other = lines.find(
        (line) => !line.classList.contains("tb-cell-active") && line.innerText.trim().length > 0,
      );
      const firstToken = (line: Element | undefined) =>
        line?.querySelector("span:not(.ms-icon):not(.tb-cell-chip *)") ?? null;

      return {
        ruleLeft: left(active),
        codeTextLeft: left(firstToken(codeLine)),
        otherLineLeft: left(other ?? null),
        otherTextLeft: left(firstToken(other ?? undefined)),
        outputLeft: left(document.querySelector(".tb-cell-output")),
      };
    });

    expect(measured.ruleLeft).not.toBeNull();
    expect(measured.codeTextLeft).not.toBeNull();
    // The rule sits clear of the content. Measured from the line's own box rather
    // than a derived px count: CodeMirror's syntax tokens start a little after the
    // line's padding, so a token's left edge is not the padding edge.
    expect((measured.codeTextLeft ?? 0) - (measured.ruleLeft ?? 0)).toBeGreaterThanOrEqual(8);
    // The negative margin and the padding cancel, so the cell's text lands where an
    // inactive line's text starts and where its own render starts.
    expect(measured.otherLineLeft).toBe(measured.codeTextLeft);
    expect(measured.otherTextLeft).toBe(measured.codeTextLeft);
    expect(measured.outputLeft).toBe(measured.codeTextLeft);

    await page.close();
  });

  it("sizes the cell rail's icons to the menu's", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Icon size",
      kind: "notebook",
      content: ["//% kind=code", "#let x = 1", ""].join("\n"),
    });
    await showPage(page, id, "write");
    await page.waitForSelector(".tb-cell-rail", { timeout: 60_000 });

    /**
     * An icon's font-size in px at the default interface size. The chrome scale
     * multiplies it, so the reading divides the scale back out and 20 stays 20
     * whatever `--ui-size` is.
     */
    const pinnedSizes = (selector: string) =>
      page.evaluate((sel) => {
        const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);

        return [...document.querySelectorAll(sel)].map((icon) =>
          Math.round(Number.parseFloat(getComputedStyle(icon).fontSize) / (root / 16)),
        );
      }, selector);

    // Every glyph on the rail is pinned to 20px at the default interface size.
    // Left alone they are 1em of `--text-xs`, which is 12px, so the chip's glyph
    // sat next to the overflow button's at a third of the size.
    const rail = await pinnedSizes(".tb-cell-rail .ms-icon");
    expect(rail.length).toBeGreaterThanOrEqual(2);
    expect(rail).toEqual(rail.map(() => 20));

    // The menu's items match the app's other menus, which `UiMenuItem` pins to 20.
    await page.locator(".tb-cell-rail button").first().click();
    await page.waitForSelector(".tb-cell-menu", { timeout: 10_000 });
    const menu = await pinnedSizes(".tb-cell-menu .ms-icon");
    expect(menu.length).toBeGreaterThan(0);
    expect(menu).toEqual(menu.map(() => 20));

    await page.close();
  });

  it("shows the caret selection on a cell attribute line", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Selection",
      kind: "notebook",
      content: ["//% kind=code", "#let n = 1", ""].join("\n"),
    });
    await showPage(page, id, "write");
    await page.waitForSelector(".tb-cell-attribute", { timeout: 60_000 });

    // The line must not be filled. An opaque `background-color`, or any
    // `background-image`, paints over CodeMirror's selection and the selected
    // attribute text loses its highlight. The boundary reads from a border,
    // which sits outside the content box and so cannot cover the text.
    const style = await page.evaluate(() => {
      const line = document.querySelector(".cm-line.tb-cell-attribute");
      if (!line) return null;
      const cs = getComputedStyle(line);

      return {
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        borderLeftWidth: cs.borderLeftWidth,
      };
    });
    expect(style).not.toBeNull();
    // `rgba(0, 0, 0, 0)` is the computed form of `transparent`.
    expect(style?.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(style?.backgroundImage).toBe("none");
    expect(style?.borderLeftWidth).not.toBe("0px");

    // And the selection itself survives, which is the part a computed style
    // cannot promise: the highlight is painted by the browser, so this reads the
    // pixels either side of the caret.
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Shift+End");

    const painted = await page.evaluate(() => {
      const line = document.querySelector(".cm-line.tb-cell-attribute");
      const range = window.getSelection()?.getRangeAt(0);
      if (!line || !range) return null;

      const cs = getComputedStyle(line);
      const box = line.getBoundingClientRect();
      const rects = [...range.getClientRects()];

      // The selection has to start inside the line, not on the rail above it.
      const inside = rects.some((r) => r.top >= box.top && r.bottom <= box.bottom + 1);

      return { inside, background: cs.backgroundColor, text: range.toString() };
    });
    expect(painted?.text).toBe("//% kind=code");
    expect(painted?.inside).toBe(true);
    expect(painted?.background).toBe("rgba(0, 0, 0, 0)");

    await page.close();
  });

  it("keeps a cell attribute from swallowing the rest of its line", async () => {
    const page = await createPage();
    await openApp(page);

    // An attribute is only an attribute when nothing else shares its line. Here it
    // is mid-line, so the heading above it has to survive as its own cell.
    const id = await createTestPage(page, {
      title: "Attribute line",
      kind: "notebook",
      content: ["= Kept //%", "", "//% kind=code", "#let x = 1", ""].join("\n"),
    });
    await showPage(page, id, "write");
    await page.waitForSelector(".tb-cell-rail", { timeout: 60_000 });

    // Two cells: the heading text above the mid-line comment, and the code one.
    expect(await page.locator(".tb-cell-rail").count()).toBe(2);
    // The heading is still in the document. Before the line rule it was inside the
    // attribute's range, so rewriting the kind deleted the line.
    const source = await page.evaluate(() => window.__typbase.view?.state.doc.toString() ?? "");
    expect(source).toContain("= Kept //%");

    // An unknown kind is a plain comment, so the attribute after it still splits
    // the page rather than the structure collapsing.
    await page.evaluate((pageId) => {
      void window.__typbase.store.setPageText(
        pageId,
        "//% kind=nope\n#let y = 2\n\n//% kind=code\n#let z = 3\n",
      );
    }, id);
    await expect.poll(() => page.locator(".tb-cell-rail").count(), { timeout: 30_000 }).toBe(2);

    await page.close();
  });

  it("decorates a converted document as cells in every mode", async () => {
    const page = await createPage();
    await openApp(page);

    // Cells are a page property, not a view mode, so converting the page is all
    // it takes and there is no mode tab to move.
    const id = await createTestPage(page, {
      title: "Converted",
      content: "= Heading first\n\nBody line.\n",
    });
    await showPage(page, id, "write");
    await page.waitForSelector(".cm-editor .typst-render", { timeout: 60_000 });

    await page.evaluate((pageId) => window.__typbase.store.updatePageKind(pageId, "notebook"), id);
    await page.waitForSelector(".tb-cell-rail", { timeout: 60_000 });
    await page.waitForTimeout(500);

    // The rail sits above the first content line rather than inside it: a
    // converted document has no attribute lines to borrow, and an inline rail
    // would push the heading's pane-width render off the end of the line.
    const boxes = await page.evaluate(() => {
      const rail = document.querySelector(".tb-cell-rail")?.getBoundingClientRect();
      const line = document.querySelector(".cm-line")?.getBoundingClientRect();
      const render = document.querySelector(".cm-line .typst-render")?.getBoundingClientRect();

      return {
        railBottom: rail?.bottom ?? 0,
        lineTop: line?.top ?? 0,
        renderRight: render?.right ?? 0,
        lineRight: line?.right ?? 0,
      };
    });
    expect(boxes.railBottom).toBeLessThanOrEqual(boxes.lineTop);
    expect(boxes.renderRight).toBeLessThanOrEqual(boxes.lineRight);

    // The mode is untouched by the conversion, which is the whole point of cells
    // not being a mode.
    expect(await page.evaluate(() => window.__typbase.mode())).toBe("write");

    // And a notebook page reads as cells without source in read mode.
    await page.evaluate(() => window.__typbase.setMode("read"));
    await page.waitForTimeout(500);
    expect(await page.locator(".tb-cell-rail").count()).toBe(0);

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

  it("resolves every glyph a frame references", async () => {
    const page = await createPage();
    await openApp(page);

    // Prose plus a heading, so the frame set holds a few dozen distinct glyphs
    // and a lot of repetition across the frames.
    const id = await createTestPage(page, {
      title: "Glyph defs",
      content:
        "= A heading in the frame set\n\n" +
        "Prose that repeats the same handful of characters over and over.\n\n" +
        "More prose, drawing on the same alphabet again.\n",
    });
    await showPage(page, id, "write");

    await page.waitForFunction(() => document.querySelectorAll(".typst-render").length >= 3, null, {
      timeout: 60_000,
    });

    // The engine writes each glyph outline once for the whole frame set and hands
    // it over, and the frames reference it. A frame carrying a `use` whose id
    // nothing in the document declares draws nothing at all, with no error
    // anywhere, so the ids are checked in the DOM rather than trusted.
    const report = await page.evaluate(() => {
      const frames = [...document.querySelectorAll(".typst-render")];
      const declared = new Set<string>();

      for (const defs of document.querySelectorAll("defs > symbol")) {
        declared.add(defs.id);
      }

      const unresolved: string[] = [];
      let references = 0;

      for (const frame of frames) {
        for (const use of frame.querySelectorAll("use")) {
          const href = use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? "";
          if (!href.startsWith("#")) continue;
          references++;
          if (!declared.has(href.slice(1))) unresolved.push(href);
        }
      }

      return { frames: frames.length, references, unresolved: [...new Set(unresolved)] };
    });

    expect(report.frames).toBeGreaterThanOrEqual(3);
    expect(report.references).toBeGreaterThan(10);
    expect(report.unresolved).toEqual([]);

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
    // compile requests the target's source. Resolving it recompiles. The
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
    // The heading is source now, so only the paragraph widget remains. Its
    // top must not move.
    expect(after).toHaveLength(1);
    expect(Math.abs(after[0]!.top - before[1]!.top)).toBeLessThan(0.5);
    await page.close();
  });

  // A completion query reads the engine's synth source, which used to be
  // rebuilt only as a side effect of a render. Write mode renders in a
  // microtask so it was always in step, but split and source mode render on a
  // debounce, so a query arriving first described the previous keystroke. The
  // editor now syncs the sources on every doc change.
  //
  // The last keystroke is the dot, which is what turns `#d` into a field access.
  // The key is already in the text, so it can only be offered by a query that read
  // the current text: a query reading the text from before the dot has no field
  // access to resolve, and answers with the variable list, where a dictionary key
  // does not appear.
  for (const mode of ["split", "source"] as const) {
    it(`completes a field access in ${mode} mode`, async () => {
      const page = await createPage();
      await openApp(page);

      const id = await createTestPage(page, {
        title: "Autocomplete",
        content: "#let d = (newname: 1)\n\n#d",
      });
      await showPage(page, id, mode);

      await page.locator(".page-view .cm-content").click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type(".");

      // activateOnTypingDelay is 100ms, which lands inside the 160ms preview
      // debounce, so this is the window the sources had to be closed in.
      await page
        .locator(".cm-tooltip-autocomplete", { hasText: "newname" })
        .waitFor({ timeout: 30_000 });
      // A resolved field access, not the variable list the stale text would give.
      expect(await page.locator(".cm-tooltip-autocomplete", { hasText: "keys" }).count()).toBe(1);
      await page.close();
    });
  }

  it("shows editor tooltips above the panes", async () => {
    const page = await createPage();
    await openApp(page);

    await page.locator(".page-view .cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n#");
    await page.waitForSelector(".cm-tooltip-autocomplete", { timeout: 60_000 });

    // The pane clips its overflow, so the tooltip has to live outside it and
    // outrank the chrome to stay visible over the sidebar and neighbors.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const tip = document.querySelector<HTMLElement>(".cm-tooltip-autocomplete");
            if (!tip) return null;

            const rect = tip.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            );

            return {
              parent: tip.parentElement?.parentElement?.tagName ?? null,
              zIndex: getComputedStyle(tip).zIndex,
              onTop: Boolean(hit && (hit === tip || tip.contains(hit))),
              inside: rect.left >= 0 && rect.right <= window.innerWidth,
            };
          }),
        { timeout: 30_000 },
      )
      .toMatchObject({ parent: "BODY", zIndex: "100", onTop: true, inside: true });

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

    // Trap the instance directly. The evaluate sees the trap. The editor's
    // next compile is what reports it to the health state.
    await page.evaluate(() => {
      try {
        window.__typbase.crashEngine();
      } catch {
        // expected: the wasm trap surfaces as a thrown RuntimeError
      }
    });

    // Typing forces a compile. The trap lands in the plugin's catch, which
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
    // usage. The watchdog evicts at 1 GB to stop the growth there. The loop
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

  it("renders a code block under a named dark theme", async () => {
    const page = await createPage();
    await openApp(page);
    await installAiStub(page, ["= Chat answer\n\n```typst\n#let x = 1\n```\n"]);

    // Nord has no default-theme code file in the worker's world, so the compile
    // has to install the palette's own tmTheme before a raw block can render.
    const previous = await page.evaluate(() => {
      const settings = window.__typbase.store.getSettings();
      window.__typbase.store.updateSettings({ theme: "dark", themeName: "nord" });

      return { theme: settings.theme, themeName: settings.themeName };
    });

    const threadId = await page.evaluate(() => window.__typbase.newChat());
    await openChatThread(page, threadId);
    await page.evaluate((id) => window.__typbase.sendChat(id, "Show code"), threadId);

    await page.waitForFunction(
      () =>
        ["verified", "unverified"].includes(
          document.querySelector(".chat-message--assistant")?.getAttribute("data-status") ?? "",
        ),
      null,
      { timeout: 90_000 },
    );

    const messages = await page.evaluate((id) => window.__typbase.chatMessages(id), threadId);
    const assistant = messages.find((message) => message.role === "assistant");
    expect(assistant?.error ?? "").toBe("");
    expect(assistant?.status).toBe("verified");
    const rendered = await page.locator(".chat-message__render").first().innerText();
    expect(rendered).toContain("let x = 1");

    await page.evaluate((restore) => window.__typbase.store.updateSettings(restore), previous);
    await page.close();
  });

  it("updates the chat's page context from the composer", async () => {
    const page = await createPage();
    await openApp(page);

    const firstId = await createTestPage(page, { title: "Context first", content: "= First\n" });
    const secondId = await createTestPage(page, { title: "Context second", content: "= Second\n" });

    const threadId = await page.evaluate((id) => window.__typbase.newChat(id), firstId);
    await openChatThread(page, threadId);
    const chip = page.locator(".chat-composer__chip--action");
    const chipText = () => chip.innerText();
    await expect.poll(chipText, { timeout: 30_000 }).toContain("Context first");

    // Pick the other page from the chip's picker.
    await chip.click();
    await page.locator(".combobox__input").fill("Context second");
    await page.locator(".combobox__item").first().click();
    await expect.poll(chipText, { timeout: 30_000 }).toContain("Context second");
    let thread = await page.evaluate((id) => window.__typbase.store.getChat(id), threadId);
    expect(thread?.pageId).toBe(secondId);

    // "No page" detaches the context.
    await chip.click();
    await page.locator(".combobox__item").first().click();
    await expect.poll(chipText, { timeout: 30_000 }).toContain("No page");
    thread = await page.evaluate((id) => window.__typbase.store.getChat(id), threadId);
    expect(thread?.pageId).toBeNull();

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

    // Add a category. The open dialog's own list must show it.
    await page.locator('.sidebar button[aria-label="Categories"]').click();
    await page.waitForSelector(".category-list", { timeout: 30_000 });
    await page.getByPlaceholder("Category name").fill("Research");
    await page.locator(".dialog").getByRole("button", { name: "Add" }).click();
    await page.locator(".category-list__row", { hasText: "Research" }).waitFor({ timeout: 30_000 });

    await page.keyboard.press("Escape");
    await page.waitForSelector(".category-list", { state: "detached", timeout: 30_000 });

    // The new-page dialog reads the same list. It must see the category too.
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
    // Selecting closes the popover, and the exit animation delays the unmount.
    await page.waitForSelector(".combobox", { state: "detached", timeout: 30_000 });

    // Reopening starts from a clean search. The previous selection's id must
    // not linger in the input.
    await page.locator('.edit-toolbar button[aria-label="Page link"]').click();
    await page.waitForSelector(".combobox__input", { timeout: 30_000 });
    expect(await page.locator(".combobox__input").inputValue()).toBe("");

    await page.close();
  });

  it("focuses the search palette and keeps Enter out of the editor", async () => {
    const page = await createPage();
    await openApp(page);

    // Select text, so an Enter that reaches the editor would replace it.
    await page.evaluate(() => {
      const view = window.__typbase.view;
      if (!view) throw new Error("no editor view");
      view.dispatch({ selection: { anchor: 0, head: Math.min(6, view.state.doc.length) } });
      view.focus();
    });
    await page.waitForTimeout(200);

    // The toolbar menu restores focus to its trigger after the palette mounts.
    // The input has to win anyway so typing lands in the search box.
    await page.locator('[aria-label="More actions"]').first().click();
    await page.getByRole("menuitem", { name: "Search" }).click();
    await page.waitForSelector(".search-palette", { timeout: 30_000 });
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Boolean((document.activeElement as HTMLElement | null)?.closest(".search-palette")),
          ),
        { timeout: 30_000 },
      )
      .toBe(true);

    await page.keyboard.type("welcome");
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (document.querySelector(".search-palette input") as HTMLInputElement | null)?.value ??
              "",
          ),
        { timeout: 30_000 },
      )
      .toContain("welcome");

    // Wait for a real hit, then open it. The reveal focuses the editor while
    // the key event is still in flight. The editor must not gain a newline.
    await page.waitForSelector(".search-palette [data-hit]", { timeout: 90_000 });
    const before = await page.evaluate(() => window.__typbase.view?.state.doc.length ?? 0);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => window.__typbase.view?.state.doc.length ?? 0);
    expect(after).toBe(before);

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

    // The links panel remembers its open state. Turn it on before the page
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

    // The newest note has no next day yet. A `none` neighbor must render
    // (three frames: heading, previous, next) and must not fail the compile.
    await page.waitForFunction(() => document.querySelectorAll(".typst-render").length >= 3, null, {
      timeout: 60_000,
    });
    await expect(page.locator(".cm-lintRange-error, .cm-lint-marker-error").count()).resolves.toBe(
      0,
    );

    await page.close();
  });

  it("edits the daily template and page prelude as Typst source", async () => {
    const page = await createPage();
    await openApp(page);

    const before = await page.evaluate(() => {
      const settings = window.__typbase.store.getSettings();

      return {
        dailyNoteTemplate: settings.dailyNoteTemplate,
        pagePrelude: settings.pagePrelude ?? "",
      };
    });

    await page.locator('[aria-label="Workspace settings"]').click();
    await page.waitForSelector(".settings", { timeout: 30_000 });
    await page.locator('[data-tab="content"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator(".settings .source-field .cm-content").count()).resolves.toBe(2);

    // The template is a Typst editor: the engine-free scanner colors keywords
    // while typing.
    const template = page.locator('.source-field [aria-label="Daily note template"]');
    await template.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("= #note.title\n\n#let x = 1");
    await expect(page.locator(".source-field .typ-key").first().innerText()).resolves.toBe("#let");

    // Blur commits, like the text fields beside it.
    await page.locator(".settings__heading").first().click();
    await expect
      .poll(() => page.evaluate(() => window.__typbase.store.getSettings().dailyNoteTemplate), {
        timeout: 30_000,
      })
      .toBe("= #note.title\n\n#let x = 1");

    // The prelude field behaves the same.
    const prelude = page.locator('.source-field [aria-label="Page prelude"]');
    await prelude.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("#set text(size: 12pt)");
    await page.locator(".settings__heading").first().click();
    await expect
      .poll(() => page.evaluate(() => window.__typbase.store.getSettings().pagePrelude), {
        timeout: 30_000,
      })
      .toBe("#set text(size: 12pt)");

    // Bracket pairs come from the Typst language data, no language server.
    await prelude.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("#f(");
    await expect(prelude.innerText()).resolves.toBe("#f()");

    await page.evaluate((previous) => window.__typbase.store.updateSettings(previous), before);
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

  it("copies, downloads, and deletes assets from the picker", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, { title: "Asset host", content: "= Assets\n" });
    await showPage(page, id, "write");

    const openPicker = async (): Promise<void> => {
      // Wide panes carry a toolbar trigger, while narrow ones hide it in the
      // overflow menu.
      const trigger = page.locator('[aria-label="Assets"]').first();
      if ((await trigger.count()) > 0) {
        await trigger.click();
      } else {
        await page.locator('[aria-label="More actions"]').first().click();
        await page.getByRole("menuitem", { name: "Assets" }).click();
      }
      await page.waitForSelector(".asset-dialog", { timeout: 30_000 });
    };

    // A real 1x1 PNG. The picker selects a fresh upload right away.
    await openPicker();
    await page.setInputFiles('.asset-dialog input[type="file"]', {
      name: "dot.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    await page.waitForFunction(
      () =>
        /#image\("\/typbase\/blob\/[0-9a-f]{16}\.png"\)/.test(
          window.__typbase.view?.state.doc.toString() ?? "",
        ),
      null,
      { timeout: 30_000 },
    );

    // Copy shows a toast. Clipboard access can be blocked, in which case the
    // fallback toast carries the reference text.
    await openPicker();
    await page.locator('.asset-dialog [aria-label="Asset actions"]').first().click();
    await page.getByRole("menuitem", { name: "Copy reference" }).click();
    await page.waitForSelector(".ui-toast", { timeout: 30_000 });

    // Download runs through the browser's download flow.
    const download = page.waitForEvent("download", { timeout: 30_000 });
    await page.locator('.asset-dialog [aria-label="Asset actions"]').first().click();
    await page.getByRole("menuitem", { name: "Download" }).click();
    await download;

    // Delete asks first, then removes the card. The confirm's shim sits above
    // the picker dialog, not under it.
    await page.locator('.asset-dialog [aria-label="Asset actions"]').first().click();
    await page.getByRole("menuitem", { name: "Delete asset" }).click();
    await page.waitForSelector(".dialog--confirm", { timeout: 30_000 });
    const stacking = await page.evaluate(() => {
      const overlays = [...document.querySelectorAll(".dialog-overlay")];
      const confirm = overlays.at(-1);
      const picker = document.querySelector(".asset-dialog");

      return {
        confirm: confirm ? Number(getComputedStyle(confirm).zIndex) : 0,
        picker: picker ? Number(getComputedStyle(picker).zIndex) : 0,
      };
    });
    expect(stacking.confirm).toBeGreaterThan(stacking.picker);
    await page.getByRole("button", { name: "Delete" }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".asset-dialog .picker__card").length === 0,
      null,
      { timeout: 30_000 },
    );

    await page.close();
  });

  it("docks the chat beside the page and roots the graph at it", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, { title: "Dock host", content: "= Dock host\n" });
    await showPage(page, id, "write");

    // The chat docks beside the page instead of replacing it.
    await page.evaluate(() => window.__typbase.openChat());
    await page.waitForSelector(".chat-pane", { timeout: 60_000 });
    await page.waitForFunction(
      () => (new URL(location.href).searchParams.get("aside") ?? "").startsWith("chat:"),
      null,
      { timeout: 30_000 },
    );
    await expect(page.locator(".cm-editor").isVisible()).resolves.toBe(true);
    // The composer names the page the thread is about.
    await expect(page.locator(".chat-composer__chip--action").innerText()).resolves.toContain(
      "Dock host",
    );

    // Expand moves the chat into the pane, and close leaves the page behind it.
    await page.locator('.chat-pane [aria-label="Expand chat"]').click();
    await page.waitForFunction(() => !new URL(location.href).searchParams.get("aside"), null, {
      timeout: 30_000,
    });
    expect(new URL(page.url()).searchParams.get("view")).toMatch(/^chat:/);
    await page.locator('.chat-pane [aria-label="Close"]').click();
    await page.waitForSelector(".cm-editor", { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("view")).toBeNull();

    // The graph opened from the links panel turns local mode on and roots it
    // at the page, so the page relation is real, not implied.
    await page.locator('[aria-label="More actions"]').first().click();
    await page.getByRole("menuitem", { name: "Links" }).click();
    await page.waitForSelector(".links", { timeout: 30_000 });
    await page.locator('[aria-label="Open graph"]').first().click();
    await page.waitForSelector(".graph canvas", { timeout: 60_000 });
    await expect
      .poll(() => page.evaluate(() => window.__typbase.store.getSettings().graph), {
        timeout: 30_000,
      })
      .toMatchObject({ local: true });
    // "Dock host" has no links, so the local graph holds only its root.
    await expect
      .poll(() => page.evaluate(() => window.__typbase.graphStats()?.nodes ?? 0), {
        timeout: 30_000,
      })
      .toBe(1);

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

    await resetGraphLocal(page);
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

  it("filters the graph from the toolbar popover", async () => {
    const page = await createPage();
    await openApp(page);
    await resetGraphLocal(page);
    await page.evaluate(() => window.__typbase.openGraph());
    await page.waitForSelector(".graph canvas", { timeout: 60_000 });

    // Every filter select gets a visible label. The toolbar itself stays to
    // the search, the scope switch, and the popover trigger.
    await page.locator(".graph__toolbar button", { hasText: "Filters" }).click();
    await page.waitForSelector(".graph__filters", { timeout: 30_000 });
    const labels = await page.locator(".graph__filter-label").allInnerTexts();
    expect(labels).toEqual(expect.arrayContaining(["Depth", "Category", "Labels"]));
    await expect(page.locator(".graph__toolbar .ui-select__trigger").count()).resolves.toBe(0);

    // Toggling "Show orphans" writes the setting and shows the badge.
    await page.locator(".graph__filters .ui-switch__track").click();
    await expect
      .poll(() => page.evaluate(() => window.__typbase.store.getSettings().graph), {
        timeout: 30_000,
      })
      .toMatchObject({ showOrphans: false });
    await expect(page.locator(".graph__filters-count").innerText()).resolves.toBe("1");

    await page.evaluate(() => {
      const store = window.__typbase.store;
      const graph = store.getSettings().graph as Record<string, unknown>;
      store.updateSettings({ graph: { ...graph, showOrphans: true } });
    });
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

    // The row menu's Category submenu moves the page. The sidebar regroups it.
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

    // "No category" puts it back in the uncategorized list, which has no title.
    await row.hover();
    await row.locator(".sidebar__row-more").click();
    await page.locator(".menu__item", { hasText: "Set category" }).click();
    await page.locator(".menu__item", { hasText: "No category" }).click();

    await page
      .locator('.sidebar__list[data-drag-list="general"] .sidebar__row', {
        hasText: "Categorize me",
      })
      .waitFor({ timeout: 30_000 });

    await page.close();
  });

  /**
   * Presses a row, drags to `ratio` of the way down the target row, and waits
   * for the gap the drop will land in. A ratio under a half puts the row above
   * the target's midpoint, so the row lands in front of it. `onHeld` runs while
   * the pointer is still down.
   */
  async function dragTo(
    page: NuxtPage,
    source: ReturnType<NuxtPage["locator"]>,
    target: ReturnType<NuxtPage["locator"]>,
    ratio: number,
    gap: string,
    onHeld?: () => Promise<void>,
  ): Promise<void> {
    const from = await source.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error("drag target has no box");

    await page.mouse.move(from.x + 24, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 24, to.y + to.height * ratio, { steps: 10 });
    await page.locator(gap).waitFor({ timeout: 10_000 });
    await onHeld?.();
    await page.mouse.up();
    await page.waitForTimeout(400);
  }

  it("reorders sidebar pages by dragging them into the open gap", async () => {
    const page = await createPage();
    await openApp(page);

    await createTestPage(page, { title: "Alpha", content: "= Alpha\n" });
    await createTestPage(page, { title: "Bravo", content: "= Bravo\n" });
    await createTestPage(page, { title: "Charlie", content: "= Charlie\n" });
    await page.waitForTimeout(400);

    const rows = page.locator('.sidebar__list[data-drag-list="general"] .sidebar__item');
    const labels = page.locator('.sidebar__list[data-drag-list="general"] .sidebar__row-label');
    const before = await labels.allInnerTexts();
    expect(before.length).toBeGreaterThan(2);

    // The last row lands in the gap the drag opens above the first one. The held
    // row leaves the flow, so the list keeps the height it had at rest.
    const listHeight = () =>
      page.evaluate(() => {
        const list = document.querySelector('.sidebar__list[data-drag-list="general"]');

        return list ? Math.round(list.getBoundingClientRect().height) : 0;
      });
    const resting = await listHeight();
    await dragTo(page, rows.last(), rows.first(), 0.1, ".sidebar__placeholder", async () => {
      expect(await listHeight()).toBe(resting);
    });

    const expected = [before.at(-1)!, ...before.slice(0, -1)];
    expect(await labels.allInnerTexts()).toEqual(expected);
    expect(
      await page.evaluate(() => window.__typbase.store.listPages().map((meta) => meta.title)),
    ).toEqual(expected);
    // The gap is gone once the order is committed.
    await expect(page.locator(".sidebar__placeholder").count()).resolves.toBe(0);

    // And a drag to the bottom of the group moves it back down.
    await dragTo(page, rows.first(), rows.last(), 0.9, ".sidebar__placeholder");
    expect(await labels.allInnerTexts()).toEqual(before);

    await page.close();
  });

  it("reorders sidebar categories by their group title", async () => {
    const page = await createPage();
    await openApp(page);

    await page.evaluate(async () => {
      const store = window.__typbase.store;
      await store.addCategory("One");
      await store.addCategory("Two");
      await store.addCategory("Three");
    });
    await page.waitForTimeout(400);

    const titles = page.locator(".sidebar__group[data-drag-group] .sidebar__group-title");
    expect(await titles.count()).toBe(3);

    await dragTo(page, titles.nth(2), titles.nth(0), 0.1, ".sidebar__placeholder");

    expect(
      await page.evaluate(() => window.__typbase.store.listCategories().map((entry) => entry.name)),
    ).toEqual(["Three", "One", "Two"]);

    await page.close();
  });

  it("reorders workspaces in the switcher", async () => {
    const page = await createPage();
    await openApp(page);

    await page.locator(".sidebar__workspace").click();
    await page.locator(".ws-menu__add").click();
    await page.locator(".dialog input").first().fill("Second");
    await page.locator('.dialog button[type="submit"]').click();
    await page.waitForTimeout(2500);

    await page.locator(".sidebar__workspace").click();
    await page.locator(".ws-menu").waitFor({ timeout: 30_000 });
    const names = page.locator(".ws-menu .ws-row__name");
    const before = await names.allInnerTexts();
    expect(before).toHaveLength(2);

    await dragTo(
      page,
      page.locator(".ws-menu [data-drag-workspace]").first(),
      page.locator(".ws-menu [data-drag-workspace]").last(),
      0.9,
      ".ws-menu .ws-gap",
    );

    // The drop is swallowed with its click, so the menu is still open.
    expect(await names.allInnerTexts()).toEqual([before[1], before[0]]);

    await page.close();
  });

  it("keeps the app bar off until the setting turns it on", async () => {
    const page = await createPage();
    await openApp(page);

    expect(await page.locator(".app-bar").count()).toBe(0);

    await enableAppBar(page);

    // The choice is device-local, so it outlives the document.
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".cm-editor", { timeout: 120_000 });
    await page.waitForSelector(".app-bar", { timeout: 30_000 });

    await page.close();
  });

  it("runs the app bar's file menu and switches menus from a trigger", async () => {
    const page = await createPage();
    await openApp(page);
    await enableAppBar(page);

    // Back has nowhere to go on the entry the app booted with.
    const [back, forward] = [0, 1].map((slot) => page.locator(".app-bar .app-bar__nav").nth(slot));
    expect(await back.isDisabled()).toBe(true);
    expect(await forward.isDisabled()).toBe(true);

    await page.locator(".menubar__trigger", { hasText: "File" }).click();
    await page.waitForSelector(".menubar__content", { timeout: 30_000 });
    expect(await page.locator(".menubar__content .menu__item").count()).toBe(4);

    // A trigger click switches menus instead of closing the bar, and the menu it
    // left is gone.
    await page.locator(".menubar__trigger", { hasText: "View" }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".menubar__content").length === 1,
      null,
      { timeout: 30_000 },
    );
    expect(
      await page.locator(".menubar__content .menu__item", { hasText: "Hide sidebar" }).count(),
    ).toBe(1);

    const panelWidth = () =>
      page.evaluate(() => {
        return document.querySelector(".app__nav-panel")?.clientWidth ?? -1;
      });
    const expanded = await panelWidth();
    expect(expanded).toBeGreaterThan(0);

    await page.locator(".menubar__content .menu__item").first().click();
    await page.waitForFunction(
      () => {
        const panel = document.querySelector(".app__nav-panel");

        return panel !== null && panel.clientWidth === 0;
      },
      null,
      { timeout: 30_000 },
    );

    // The view menu now names the other direction, which brings it back.
    await page.locator(".menubar__trigger", { hasText: "View" }).click();
    await page.waitForSelector(".menubar__content", { timeout: 30_000 });
    expect(
      await page.locator(".menubar__content .menu__item", { hasText: "Show sidebar" }).count(),
    ).toBe(1);
    await page.locator(".menubar__content .menu__item").first().click();
    await page.waitForFunction(
      () => (document.querySelector(".app__nav-panel")?.clientWidth ?? 0) > 0,
      null,
      { timeout: 30_000 },
    );
    // Reka restores the size the panel had before it collapsed.
    expect(Math.abs((await panelWidth()) - expanded)).toBeLessThanOrEqual(2);
    // Let the splitter animation finish before the next click lands.
    await page.waitForTimeout(500);

    // The File menu's dialogs open from items, which close the menu to do it.
    await page.locator(".menubar__trigger", { hasText: "File" }).click();
    await page.waitForSelector(".menubar__content .menu__item", { timeout: 30_000 });
    await page.locator(".menubar__content .menu__item", { hasText: "New page" }).click();
    await page.waitForSelector(".dialog", { timeout: 30_000 });
    // The dropdown animates out, so wait for it to go rather than sampling.
    await page.waitForSelector(".menubar__content", { state: "detached", timeout: 30_000 });

    // Back closes the dialog it opened.
    await page.evaluate(() => window.history.back());
    await page.waitForSelector(".dialog", { state: "detached", timeout: 30_000 });

    // And the menu, without navigating away.
    await page.locator(".menubar__trigger", { hasText: "File" }).click();
    await page.waitForSelector(".menubar__content", { timeout: 30_000 });
    await page.evaluate(() => window.history.back());
    await page.waitForSelector(".menubar__content", { state: "detached", timeout: 30_000 });
    expect(new URL(page.url()).pathname).toBe("/");

    await page.close();
  });

  it("navigates pages with the app bar's back and forward buttons", async () => {
    const page = await createPage();
    await openApp(page);
    await enableAppBar(page);

    const firstId = await createTestPage(page, { title: "Nav first", content: "= First\n" });
    const secondId = await createTestPage(page, { title: "Nav second", content: "= Second\n" });
    await showPage(page, firstId, "write");

    const [back, forward] = [0, 1].map((slot) => page.locator(".app-bar .app-bar__nav").nth(slot));
    expect(await back.isDisabled()).toBe(false);

    await page.evaluate((id) => window.__typbase.openPage(id), secondId);
    await page.waitForFunction((id) => window.__typbase.pageId === id, secondId, {
      timeout: 30_000,
    });

    await back.click();
    await page.waitForFunction((id) => window.__typbase.pageId === id, firstId, {
      timeout: 30_000,
    });
    expect(await forward.isDisabled()).toBe(false);

    await forward.click();
    await page.waitForFunction((id) => window.__typbase.pageId === id, secondId, {
      timeout: 30_000,
    });
    expect(await back.isDisabled()).toBe(false);

    await page.close();
  });

  it("offers a way out of a workspace with no pages", async () => {
    const page = await createPage();
    await openApp(page);

    await createTestPage(page, { title: "Last one", content: "= Last one\n" });

    // Every page goes, including the seeded home page: the shell used to open
    // that dead id and show "no page" where the empty pane belongs.
    const emptied = await page.evaluate(async () => {
      const store = window.__typbase.store;
      for (const meta of store.listPages()) await store.deletePage(meta.id);

      return store.listPages().length;
    });
    expect(emptied).toBe(0);

    await page.waitForSelector(".app__empty", { timeout: 30_000 });
    expect(await page.locator(".app__empty-title").innerText()).toBe("No pages yet");
    expect(await page.locator(".cm-editor").count()).toBe(0);
    // The home page id is cleared with the page.
    expect(
      await page.evaluate(() => window.__typbase.store.getSettings().homePageId ?? null),
    ).toBeNull();

    // Today's note is the other way in: it creates the page on first tap.
    await page.locator(".app__empty-actions .button", { hasText: "Today's note" }).click();
    await page.waitForSelector(".cm-editor", { timeout: 60_000 });
    const dailyPath = await page.evaluate(() => {
      const id = window.__typbase.pageId;

      return id ? window.__typbase.store.getPage(id)?.path : null;
    });
    expect(dailyPath).toMatch(/^daily\/\d{4}-\d{2}-\d{2}\.typ$/);
    // That daily note is the page later tests find, so the workspace is not left
    // empty for them.

    await page.close();
  });

  it("renames a page and moves its file unless the rename opts out", async () => {
    const page = await createPage();
    await openApp(page);

    const id = await createTestPage(page, {
      title: "Rename source",
      content: "= Rename source\n",
    });
    await showPage(page, id, "write");

    const row = page.locator(".sidebar__item", { hasText: "Rename source" });
    await row.hover();
    await row.locator(".sidebar__row-more").click();
    await page.locator(".menu__item", { hasText: "Rename" }).click();

    // The file follows the title while its path is the one the title derived,
    // and the dialog says which way before anything moves.
    const title = page.locator(".dialog input").first();
    await title.fill("Rename target");
    const hint = page.locator(".dialog .dialog__hint");
    await hint.waitFor({ timeout: 30_000 });
    expect(await hint.innerText()).toContain("pages/rename-source.typ");
    expect(await hint.innerText()).toContain("pages/rename-target.typ");

    await page.locator('.dialog button[type="submit"]').click();
    await page.waitForFunction(
      (pageId) => window.__typbase.store.getPage(pageId)?.path === "pages/rename-target.typ",
      id,
      { timeout: 30_000 },
    );

    // The page is still the open document, and it still compiles.
    expect(await page.evaluate(() => window.__typbase.pageId)).toBe(id);
    await page.waitForSelector(".cm-editor", { timeout: 60_000 });
    await page.locator(".cm-content").click();
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__typbase.engineStatus())).toBe("ok");

    // Opting out keeps the file name, which is what a git-tracked workspace wants.
    const renamed = page.locator(".sidebar__item", { hasText: "Rename target" });
    await renamed.hover();
    await renamed.locator(".sidebar__row-more").click();
    await page.locator(".menu__item", { hasText: "Rename" }).click();
    await page.locator(".dialog input").first().fill("Rename kept");
    await page.locator(".dialog .dialog__hint").waitFor({ timeout: 30_000 });
    await page.locator(".ui-switch", { hasText: "Rename the file too" }).locator("button").click();
    await page.locator('.dialog button[type="submit"]').click();

    await page.waitForFunction(
      (pageId) => window.__typbase.store.getPage(pageId)?.title === "Rename kept",
      id,
      { timeout: 30_000 },
    );
    expect(await page.evaluate((pageId) => window.__typbase.store.getPage(pageId)?.path, id)).toBe(
      "pages/rename-target.typ",
    );

    await page.close();
  });

  it("boots the shell offline once the worker has cached it", async () => {
    const page = await createPage();
    await openApp(page);

    // The app registers the worker in production only, but the suite registers it
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
