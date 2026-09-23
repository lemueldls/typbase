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
        updateSettings(patch: Record<string, unknown>): void;
        getAiSettings(): Record<string, unknown>;
        readChatMessages(id: string): Promise<Array<{ id: string; status: string }>>;
        deleteChat(id: string): Promise<void>;
      };
      openPage(id: string): void;
      setMode(mode: string): void;
      mode(): string;
      engineStatus(): string;
      engineMemory(): number;
      crashEngine(): void;
      openChat(threadId?: string | null): void;
      newChat(pageId?: string | null): Promise<string>;
      sendChat(threadId: string, text: string): Promise<void>;
      chatMessages(threadId: string): Promise<Array<{ id: string; status: string }>>;
      setAiStub(provider: unknown): void;
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
          const text =
            scriptedReplies[Math.min(calls, scriptedReplies.length - 1)] ?? "= Empty\n";
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

    const calls = await page.evaluate(
      () => (window as unknown as { __aiCalls: number }).__aiCalls,
    );
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
});
