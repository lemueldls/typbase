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

    // Opening the pane subscribes its surface. It compiles the patched state.
    await page.evaluate((id) => window.__typbase.openPlugin(id), instanceId);
    await page.waitForFunction(
      ({ id, title }) =>
        window.__typbase.pluginStatus(id, "pane") === "ok" &&
        window.__typbase.pluginHtml(id, "pane").includes(title),
      { id: instanceId, title: "Dentist" },
      { timeout: 60_000 },
    );

    // A view-only action (selecting a day) must re-render on its own. Before,
    // the outline only moved after some other action forced a render. Pick
    // another day in the current month: the grid only marks cells in the
    // month it shows, so a next-month date would leave it unmarked.
    const now = new Date();
    const day = now.getUTCDate();
    const otherDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day === 1 ? 2 : day - 1),
    )
      .toISOString()
      .slice(0, 10);
    await page.evaluate(
      ({ id, date }) => window.__typbase.pluginAction(id, "pane", "calendar.select", { date }),
      { id: instanceId, date: otherDay },
    );
    await page.waitForFunction(
      ({ id, date }) => {
        const html = window.__typbase.pluginHtml(id, "pane");
        const selected = html.match(/<button[^>]*cal-day--selected[^>]*>/)?.[0] ?? "";

        return selected.includes(date);
      },
      { id: instanceId, date: otherDay },
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
    // The window mounts its surface asynchronously. The canvas host appends
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
    // The snippet names the module rather than importing `embed` bare, so the
    // note gets one namespaced call instead of a loose binding.
    expect(text).toContain('#import "/typbase/plugin/drawing/main.typ" as drawing');
    expect(text).toContain("#drawing.embed(");

    // The open editor adopts the appended text without a reload, and the
    // imported module resolves.
    await page.waitForFunction(
      () => (window.__typbase.view?.state.doc.toString() ?? "").includes("as drawing"),
      null,
      { timeout: 30_000 },
    );

    await page.close();
  });

  it("opens the plugin when an embed's link is clicked", async () => {
    const page = await createPage();
    await openApp(page);

    // The drawing wraps its board in a `typbase://plugin/<id>` link, so clicking
    // the drawing in a note is the way back to the window that owns it. That is
    // the whole point of the link: the embed is a view of the instance's data,
    // and the data is edited in the plugin.
    const instanceId = await page.evaluate(() => window.__typbase.installPlugin("local:drawing"));
    await page.evaluate(
      (id) =>
        window.__typbase.pluginAction(id, "window", "stroke.add", {
          stroke: { color: "#b42828", width: 3, points: [[4, 4], [12, 18]] },
        }),
      instanceId,
    );

    const noteId = await page.evaluate(async (id) => {
      const store = window.__typbase.store;
      const meta = await store.createPage({
        title: "Embeds a drawing",
        content: `#import "/typbase/plugin/drawing/main.typ" as drawing\n#drawing.embed("${id}")\n`,
      });

      return meta.id;
    }, instanceId);
    await page.evaluate((id) => window.__typbase.openPage(id), noteId);

    // The embed is a real anchor in the rendered frame, not decoration.
    await page.waitForSelector('.typst-render a[href^="typbase://plugin/"]', { timeout: 60_000 });

    expect(await page.evaluate((id) => window.__typbase.pluginWindowOpen(id), instanceId)).toBe(
      false,
    );

    await page.locator('.typst-render a[href^="typbase://plugin/"]').first().click();

    await page.waitForFunction((id) => window.__typbase.pluginWindowOpen(id), instanceId, {
      timeout: 30_000,
    });

    await page.close();
  });

  it("carries plugin sources into an exported bundle and the project mirror", async () => {
    const page = await createPage();
    await openApp(page);

    // A note that carries the embed the insert action writes. The note is never
    // opened, so nothing in the app has compiled it and no request has asked for
    // the plugin module: whatever the bundle and the mirror carry, they carried
    // it without being told to.
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
    const noteId = await page.evaluate(async (id) => {
      const store = window.__typbase.store;
      const meta = await store.createPage({
        title: "Carries a drawing",
        content: `#import "/typbase/plugin/drawing/main.typ" as drawing\n#drawing.embed("${id}")\n`,
      });

      return meta.id;
    }, instanceId);

    // The export bundle has to stand on its own: compiled against its own files
    // and nothing else, because the app's request channel is not there to answer.
    const bundle = await page.evaluate((id) => window.__typbase.exportPage(id, {}), noteId);
    const names = bundle.files.map((file) => file.name);
    expect(names, "bundle is missing the plugin module").toContain(
      "typbase/plugin/drawing/main.typ",
    );
    // The embed reads the instance's records, which live in a doc a compiler
    // cannot open, so the bundle has to carry them as query JSON too.
    expect(names, "bundle is missing the plugin data").toContain(
      `typbase/query/plugin-data/${instanceId}.json`,
    );

    const check = await page.evaluate(
      ({ files }) => window.__typbase.compileBundle(files, "carries-a-drawing.typ"),
      { files: bundle.files },
    );
    expect(check.foundEntry).toBe(true);
    expect(check.missing, "the compile asked for files the bundle lacks").toEqual([]);
    expect(check.errors).toEqual([]);

    // The project mirror is the same promise for external tools, so it carries
    // the module too rather than relying on the editor having requested it.
    await page.evaluate((id) => window.__typbase.mirrorPage(id), noteId);
    const mirrored = await page.evaluate(() =>
      window.__typbase.readProjectFile("typbase/plugin/drawing/main.typ"),
    );
    expect(mirrored, "the mirror is missing the plugin module").toContain("#let embed");

    await page.close();
  });

  it("notices that an installed plugin's sources moved on", async () => {
    const page = await createPage();
    await openApp(page);

    await page.evaluate(async () => {
      await window.__typbase.writeWorkspaceFile(
        "plugins/versioned/plugin.json",
        JSON.stringify({
          id: "local:versioned",
          name: "Versioned",
          version: "1.0.0",
          api: "typbase.host.v2",
          entry: "main.typ",
          capabilities: ["plugin.data"],
          collections: {},
          surfaces: [{ kind: "widget", fn: "widget", title: "Versioned" }],
        }),
      );
      await window.__typbase.writeWorkspaceFile(
        "plugins/versioned/main.typ",
        ['#import "/typbase/ui.typ": *', "", "#let widget(ctx) = surface([build 1.0.0])"].join(
          "\n",
        ),
      );
      await window.__typbase.refreshPlugins();
    });

    const instanceId = await page.evaluate(() => window.__typbase.installPlugin("local:versioned"));
    await page.waitForFunction(
      ({ id, want }) => window.__typbase.pluginHtml(id, "widget").includes(want),
      { id: instanceId, want: "build 1.0.0" },
      { timeout: 60_000 },
    );

    // The install record starts at the version that was installed.
    await expect
      .poll(() =>
        page.evaluate(() => window.__typbase.store.getPluginInstall("local:versioned")?.version),
      )
      .toBe("1.0.0");

    // Rewrite the plugin on disk, the way editing it in the studio or replacing
    // its folder would. The refresh is explicit because OPFS has no storage
    // watcher; the studio's save path calls exactly this after a write.
    await page.evaluate(async () => {
      await window.__typbase.writeWorkspaceFile(
        "plugins/versioned/plugin.json",
        JSON.stringify({
          id: "local:versioned",
          name: "Versioned",
          version: "2.0.0",
          api: "typbase.host.v2",
          entry: "main.typ",
          capabilities: ["plugin.data"],
          collections: {},
          surfaces: [{ kind: "widget", fn: "widget", title: "Versioned" }],
        }),
      );
      await window.__typbase.writeWorkspaceFile(
        "plugins/versioned/main.typ",
        ['#import "/typbase/ui.typ": *', "", "#let widget(ctx) = surface([build 2.0.0])"].join(
          "\n",
        ),
      );
      await window.__typbase.refreshPlugins();
    });

    // The mounted surface shows the new build. That part already worked, because a
    // catalog refresh re-registers the sources.
    await expect
      .poll(() => page.evaluate((id) => window.__typbase.pluginHtml(id, "widget"), instanceId), {
        timeout: 30_000,
      })
      .toContain("build 2.0.0");

    // The install record is what was stale: it is what the sidebar and the studio
    // read to show a version, a surface list, and a capability set.
    await expect
      .poll(() =>
        page.evaluate(() => window.__typbase.store.getPluginInstall("local:versioned")?.version),
      )
      .toBe("2.0.0");

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

  it("refuses state writes from a plugin without plugin.data", async () => {
    const page = await createPage();
    await openApp(page);

    // `capabilities` is empty, so the plugin never asked for `plugin.data`. Its
    // surface still patches, because nothing in the manifest stops it from
    // trying: the capability is what has to stop it.
    await page.evaluate(async () => {
      await window.__typbase.writeWorkspaceFile(
        "plugins/nodata/plugin.json",
        JSON.stringify({
          id: "local:nodata",
          name: "No Data",
          version: "0.1.0",
          api: "typbase.host.v2",
          entry: "main.typ",
          capabilities: [],
          collections: {
            notes: { fields: { title: { type: "string" } } },
          },
          surfaces: [{ kind: "widget", fn: "pane", title: "No Data" }],
        }),
      );
      await window.__typbase.writeWorkspaceFile(
        "plugins/nodata/main.typ",
        [
          '#import "/typbase/ui.typ": *',
          "",
          "#let pane(ctx) = {",
          "  // Patch only after an action, the way a well-behaved plugin does.",
          "  let patch = if ctx.action != none {",
          '    ops-state((op-append("notes", (id: "n1", title: "x")),))',
          "  } else { (:) }",
          "  surface(",
          '    [writes #ctx.state.at("notes", default: ()).len() records],',
          "    ..patch,",
          "  )",
          "}",
        ].join("\n"),
      );
      await window.__typbase.refreshPlugins();
    });

    const instanceId = await page.evaluate(() => window.__typbase.installPlugin("local:nodata"));
    await page.evaluate((id) => window.__typbase.pluginAction(id, "widget", "noop"), instanceId);
    await page.waitForFunction(
      (id) => window.__typbase.pluginStatus(id, "widget") === "ok",
      instanceId,
      { timeout: 60_000 },
    );

    // The read is empty too, so the surface cannot render a record it may not write.
    expect(
      await page.evaluate((id) => window.__typbase.pluginHtml(id, "widget"), instanceId),
    ).toContain("writes 0 records");

    // And nothing landed in the doc.
    expect(await page.evaluate((id) => window.__typbase.pluginState(id), instanceId)).toEqual({});

    // The refusal is reported, so the author sees why the button did nothing.
    expect(await page.evaluate(() => window.__typbase.pluginLogs())).toContainEqual(
      expect.stringContaining('missing capability "plugin.data"'),
    );

    await page.close();
  });

  it("shows a denied action on the surface rather than only in the log", async () => {
    const page = await createPage();
    await openApp(page);

    // A pane with no capabilities at all, whose only button asks the host to
    // create a page. The click cannot work, and the surface has to say so.
    await page.evaluate(async () => {
      await window.__typbase.writeWorkspaceFile(
        "plugins/denied/plugin.json",
        JSON.stringify({
          id: "local:denied",
          name: "Denied",
          version: "0.1.0",
          api: "typbase.host.v2",
          entry: "main.typ",
          capabilities: [],
          collections: {},
          surfaces: [{ kind: "pane", fn: "pane", title: "Denied" }],
        }),
      );
      await window.__typbase.writeWorkspaceFile(
        "plugins/denied/main.typ",
        [
          '#import "/typbase/ui.typ": *',
          "",
          "#let pane(ctx) = surface([",
          '  #button("Make a page", action: "app.create-page", args: (title: "x")),',
          "])",
        ].join("\n"),
      );
      await window.__typbase.refreshPlugins();
    });

    const instanceId = await page.evaluate(() => window.__typbase.installPlugin("local:denied"));
    await page.evaluate((id) => window.__typbase.openPlugin(id), instanceId);
    await page.waitForFunction(
      (id) => window.__typbase.pluginStatus(id, "pane") === "ok",
      instanceId,
      { timeout: 60_000 },
    );

    await page.evaluate(
      (id) => window.__typbase.pluginAction(id, "pane", "app.create-page", { title: "Nope" }),
      instanceId,
    );

    // The surface carries the reason, so the button is not simply dead.
    await page.waitForFunction(
      (id) => window.__typbase.pluginStatus(id, "pane") === "error",
      instanceId,
      {
        timeout: 30_000,
      },
    );
    await expect
      .poll(() => page.locator(".plugin-surface__error-text").first().textContent(), {
        timeout: 30_000,
      })
      .toContain("pages.create");

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
    // would be dropped. Retry until the selection sticks.
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
