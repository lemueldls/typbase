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
});
