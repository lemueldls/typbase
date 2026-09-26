import type { NuxtPage } from "@nuxt/test-utils/e2e";

import { createPage, setup, url } from "@nuxt/test-utils/e2e";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Plugin e2e: installs bundled plugins through the dev-only handle and drives
 * their surfaces without touching the UI. Verifies the v2 wrapper compiles,
 * that one instance shares its data doc across surfaces, that windows mount
 * through the host, and that a broken local source lands in the error state.
 */

describe("plugin system", async () => {
  await setup({
    rootDir: fileURLToPath(new URL("../", import.meta.url)),
    dev: true,
    browser: true,
    browserOptions: { type: "chromium" },
    nuxtConfig: { buildDir: ".nuxt-e2e" },
    env: { NUXT_IGNORE_LOCK: "1" },
    setupTimeout: 300_000,
  });

  async function openApp(page: NuxtPage, path = "/"): Promise<void> {
    await page.addInitScript(() => localStorage.setItem("typbase:storageMode", "opfs"));
    await page.goto(url(path), { waitUntil: "load" });
    await page.waitForSelector(".sidebar", { timeout: 180_000 });
    await page.waitForFunction(() => document.fonts.status === "loaded", null, {
      timeout: 60_000,
    });
  }

  it("shares one data doc between the calendar widget and pane", async () => {
    const page = await createPage();
    await openApp(page);

    const instanceId = await page.evaluate(() => window.__typbase.installPlugin("local:calendar"));
    expect(instanceId).toBeTruthy();

    await page.waitForFunction(
      (id) => window.__typbase.pluginStatus(id, "widget") === "ok",
      instanceId,
      { timeout: 120_000 },
    );

    const today = new Date().toISOString().slice(0, 10);
    await page.evaluate(
      ({ id, date }) =>
        window.__typbase.pluginAction(
          id,
          "pane",
          "event.create",
          { date },
          { title: "Dentist", date, time: "10:00" },
        ),
      { id: instanceId, date: today },
    );

    // The event lands in the instance doc and both surfaces read it.
    const state = await page.evaluate((id) => window.__typbase.pluginState(id), instanceId);
    expect(state.events).toHaveLength(1);
    expect((state.events[0] as { title: string }).title).toBe("Dentist");

    await page.waitForFunction(
      ({ id, title }) => window.__typbase.pluginHtml(id, "widget").includes(title),
      { id: instanceId, title: "Dentist" },
      { timeout: 60_000 },
    );

    // Opening the pane subscribes its surface; it compiles the patched state.
    await page.evaluate((id) => window.__typbase.openPlugin(id), instanceId);
    await page.waitForFunction(
      ({ id, title }) =>
        window.__typbase.pluginStatus(id, "pane") === "ok" &&
        window.__typbase.pluginHtml(id, "pane").includes(title),
      { id: instanceId, title: "Dentist" },
      { timeout: 60_000 },
    );

    // A view-only action (selecting a day) must re-render on its own; before,
    // the outline only moved after some other action forced a render.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await page.evaluate(
      ({ id, date }) => window.__typbase.pluginAction(id, "pane", "calendar.select", { date }),
      { id: instanceId, date: tomorrow },
    );
    await page.waitForFunction(
      ({ id, date }) => {
        const html = window.__typbase.pluginHtml(id, "pane");
        const selected = html.match(/<button[^>]*cal-day--selected[^>]*>/)?.[0] ?? "";

        return selected.includes(date);
      },
      { id: instanceId, date: tomorrow },
      { timeout: 30_000 },
    );

    await page.close();
  });

  it("repaints the brush when a swatch is clicked", async () => {
    const page = await createPage();
    await openApp(page);

    const instanceId = await page.evaluate(() => window.__typbase.installPlugin("local:drawing"));
    await page.evaluate((id) => window.__typbase.openPlugin(id), instanceId);
    await page.waitForFunction((id) => window.__typbase.pluginWindowOpen(id), instanceId, {
      timeout: 30_000,
    });

    // Use the swatch's own theme color: the palette depends on the workspace
    // theme, so a hardcoded seed would only pass on the default theme.
    await page.waitForFunction(
      () => {
        const host = document.querySelector(".plugin-window .plugin-surface");

        return (host?.shadowRoot?.querySelectorAll("button.tb-swatch").length ?? 0) > 1;
      },
      null,
      { timeout: 30_000 },
    );
    const color = await page.evaluate(() => {
      const host = document.querySelector(".plugin-window .plugin-surface");
      const swatch = host?.shadowRoot?.querySelectorAll("button.tb-swatch")[1];

      return swatch?.getAttribute("style")?.split(":")[1] ?? "";
    });
    expect(color).toMatch(/^#/);

    await page.evaluate(
      ({ id, swatchColor }) =>
        window.__typbase.pluginAction(id, "window", "draw.color", { color: swatchColor }),
      { id: instanceId, swatchColor: color },
    );
    await page.waitForFunction(
      ({ id, swatchColor }) => {
        const html = window.__typbase.pluginHtml(id, "window");
        const tag = html.match(new RegExp(`<button[^>]*${swatchColor}[^>]*>`))?.[0] ?? "";

        return tag.includes("tb-button--selected");
      },
      { id: instanceId, swatchColor: color },
      { timeout: 30_000 },
    );

    await page.close();
  });

  it("opens the drawing plugin in a host window and stores strokes", async () => {
    const page = await createPage();
    await openApp(page);

    const instanceId = await page.evaluate(() => window.__typbase.installPlugin("local:drawing"));
    await page.evaluate(
      (id) =>
        window.__typbase.pluginAction(id, "window", "stroke.add", {
          stroke: {
            color: "#b42828",
            width: 3,
            points: [
              [4, 4],
              [12, 18],
            ],
          },
        }),
      instanceId,
    );

    const state = await page.evaluate((id) => window.__typbase.pluginState(id), instanceId);
    expect(state.strokes).toHaveLength(1);

    await page.evaluate((id) => window.__typbase.openPlugin(id), instanceId);
    await page.waitForFunction((id) => window.__typbase.pluginWindowOpen(id), instanceId, {
      timeout: 30_000,
    });
    // The window mounts its surface asynchronously; the canvas host appends
    // the real canvas on mount.
    await page.waitForSelector(".plugin-window canvas.tb-canvas", { timeout: 30_000 });

    // Top-level blocks get host spacing: the drawing returns two panels and
    // the second one carries the surface gap.
    const gap = await page.evaluate(() => {
      const host = document.querySelector(".plugin-window .plugin-surface");
      const surface = host?.shadowRoot?.querySelector("#tb-root .tb-surface");
      const panels = surface ? [...surface.children] : [];

      return panels.length >= 2 ? getComputedStyle(panels[1]).marginTop : "";
    });
    expect(gap).toBe("12px");

    // The insert button chains page-append and window-close, and toasts.
    const targetId = await page.evaluate(async () => {
      const meta = await window.__typbase.store.createPage({ title: "Insert target", content: "" });

      return meta.id;
    });
    await page.evaluate((id) => window.__typbase.openPage(id), targetId);
    await page.locator(".plugin-window button", { hasText: "Insert in the open note" }).click();
    await page.waitForSelector(".ui-toast", { timeout: 15_000 });
    await page.waitForFunction((id) => !window.__typbase.pluginWindowOpen(id), instanceId, {
      timeout: 30_000,
    });

    const text = await page.evaluate((id) => window.__typbase.store.loadPageText(id), targetId);
    expect(text).toContain("/typbase/plugin/local-drawing/main.typ");

    // The open editor adopts the appended text without a reload.
    await page.waitForFunction(
      () => (window.__typbase.view?.state.doc.toString() ?? "").includes("local-drawing"),
      null,
      { timeout: 30_000 },
    );

    await page.close();
  });

  it("renames an instance from the plugin manager", async () => {
    const page = await createPage();
    await openApp(page);

    const instanceId = await page.evaluate(() => window.__typbase.installPlugin("local:drawing"));
    await page.locator(".plugin-sidebar__header button").click();
    await page.locator('[aria-label="Rename instance"]').first().click();
    await page.locator(".plugin-manager__rename input").fill("Sketchbook");
    await page.getByRole("button", { name: "Save" }).click();

    await page.waitForFunction(
      (id) => window.__typbase.store.getPluginInstance(id)?.title === "Sketchbook",
      instanceId,
      { timeout: 30_000 },
    );

    await page.close();
  });

  it("surfaces a broken local plugin as an error state", async () => {
    const page = await createPage();
    await openApp(page);

    await page.evaluate(async () => {
      await window.__typbase.writeWorkspaceFile(
        "plugins/broken/plugin.json",
        JSON.stringify({
          id: "local:broken",
          name: "Broken",
          version: "0.1.0",
          api: "typbase.host.v2",
          entry: "main.typ",
          capabilities: [],
          collections: {},
          surfaces: [{ kind: "pane", fn: "pane", title: "Broken" }],
        }),
      );
      await window.__typbase.writeWorkspaceFile(
        "plugins/broken/main.typ",
        "#let pane(ctx) = surface(ui: [this is not (valid",
      );
      await window.__typbase.refreshPlugins();
    });

    const instanceId = await page.evaluate(() => window.__typbase.installPlugin("local:broken"));
    await page.evaluate((id) => window.__typbase.pluginAction(id, "pane", "noop"), instanceId);

    await page.waitForFunction(
      (id) => window.__typbase.pluginStatus(id, "pane") === "error",
      instanceId,
      {
        timeout: 60_000,
      },
    );

    await page.close();
  });

  it("renders the studio with an editor for a local plugin", async () => {
    const page = await createPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });

    // The studio is its own page: no sidebar and no editor to wait for.
    await page.addInitScript(() => localStorage.setItem("typbase:storageMode", "opfs"));
    await page.goto(url("/plugins"), { waitUntil: "load" });

    await page.waitForSelector(".studio", { timeout: 180_000 });
    await page.waitForSelector(".studio__plugin", { timeout: 180_000 });

    // A click can land before the client-only page finishes mounting, which
    // would be dropped; retry until the selection sticks.
    let tabs = 0;
    for (let attempt = 0; attempt < 10 && tabs === 0; attempt++) {
      await page
        .locator(".studio__plugin")
        .first()
        .click({ timeout: 2000 })
        .catch(() => {});
      await page.waitForTimeout(500);
      tabs = await page.locator(".studio__tab").count();
    }
    expect(tabs).toBeGreaterThan(0);
    expect(errors).toEqual([]);

    await page.locator(".studio__tab", { hasText: "source" }).click();
    await page.waitForSelector(".studio-editor .cm-editor", { timeout: 60_000 });

    await page.close();
  });
});
