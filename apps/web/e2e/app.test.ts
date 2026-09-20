import type { NuxtPage } from "@nuxt/test-utils/e2e";

import { createPage, setup, url } from "@nuxt/test-utils/e2e";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Full-app e2e: a real dev server, a real Chromium, a real OPFS workspace.
 * State is created through `window.__typbase.store` (dev-only) instead of the
 * UI, so tests exercise the engine and the editor rather than dialogs.
 */
declare global {
  interface Window {
    __typbase: {
      store: {
        createPage(input: {
          title: string;
          content?: string;
          kind?: "document" | "notebook";
          categoryId?: string | null;
        }): Promise<{ id: string; title: string }>;
        loadPageText(id: string): Promise<string>;
        flush(): Promise<void>;
      };
      openPage(id: string): void;
      setMode(mode: string): void;
      mode(): string;
      engineStatus(): string;
      engineMemory(): number;
      crashEngine(): void;
    };
  }
}

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
    const memory = await page.evaluate(() => window.__typbase.engineMemory());
    expect(memory).toBeGreaterThan(0);
    expect(memory).toBeLessThan(1_000_000_000);

    // The text still saves and the engine still compiles the final source.
    await page.evaluate(() => window.__typbase.store.flush());
    const text = await page.evaluate((pageId) => window.__typbase.store.loadPageText(pageId), id);
    expect(text).toContain("#let doomed = 11");

    await page.close();
  });
});
