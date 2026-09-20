import { mkdir } from "node:fs/promises";

import { seedWorkspace } from "./seed.mjs";

/**
 * Shared plumbing for the demo capture scripts. Both the stills
 * (`capture.mjs`) and the clips (`clips.mjs`) boot the same seeded workspace
 * and drive it through the dev-only `window.__typbase` handle.
 */

export const APP = process.env.DEMO_APP_URL ?? "http://127.0.0.1:3000";
export const IMAGES = new URL("../../docs/images/", import.meta.url).pathname;
export const VIDEOS = new URL("../../docs/video/", import.meta.url).pathname;
export const WORKSPACE_ID = "demo";
// Smaller viewport with the same 2x density: the chrome and text fill
// more of the frame, which reads better when the images are scaled down.
export const VIEWPORT = { width: 1280, height: 800 };

/** One theme per shot, covering the sizing and radius presets. */
export const SHOT_SETTINGS = {
  "notebook-hero": {
    theme: "light",
    themeName: "default",
    uiSize: "default",
    uiDensity: "default",
    uiRadius: "default",
  },
  "query-split": {
    theme: "dark",
    themeName: "catppuccin",
    uiSize: "small",
    uiDensity: "compact",
    uiRadius: "square",
  },
  wysiwyg: {
    theme: "light",
    themeName: "evergarden",
    uiSize: "large",
    uiDensity: "spacious",
    uiRadius: "round",
  },
};

export async function ensureDirs() {
  await mkdir(IMAGES, { recursive: true });
  await mkdir(VIDEOS, { recursive: true });
}

/** Collapses the formatting strip so the stills are about the document. */
export async function installChromePreferences(context) {
  await context.addInitScript(() => localStorage.setItem("typbase:formatToolbar", "false"));
}

/**
 * A fake pointer for the clips: Playwright video does not render the real
 * cursor, and a clip without one is hard to follow. The overlay follows
 * `mousemove`, which `page.mouse` dispatches like a real pointer.
 */
export async function installCursor(context) {
  await context.addInitScript(() => {
    const attach = () => {
      if (document.getElementById("__demo-cursor")) return;

      const cursor = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      cursor.id = "__demo-cursor";
      cursor.setAttribute("viewBox", "0 0 20 20");
      cursor.innerHTML =
        '<path d="M3 2l12 8-5 .8 3 6-2.4 1.2-3-6L3 15z" fill="#fff" stroke="#111" stroke-width="1.1"/>';
      Object.assign(cursor.style, {
        position: "fixed",
        left: "0",
        top: "0",
        width: "20px",
        height: "20px",
        zIndex: "2147483647",
        pointerEvents: "none",
        filter: "drop-shadow(0 1px 1px rgb(0 0 0 / 0.45))",
        transform: "translate(-100px, -100px)",
      });
      document.body.append(cursor);
    };

    document.addEventListener(
      "mousemove",
      (event) => {
        const cursor = document.getElementById("__demo-cursor");
        if (cursor) cursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
      },
      true,
    );
    document.addEventListener("DOMContentLoaded", attach);
    if (document.body) attach();
  });
}

export async function boot(page) {
  await page.goto(APP, { waitUntil: "load", timeout: 180_000 });
  await page.waitForSelector(".sidebar", { timeout: 180_000 });
  await page.waitForSelector(".cm-editor", { timeout: 180_000 });
  await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 60_000 });
}

/**
 * Builds the demo workspace before the app ever loads. The seed runs on a
 * blank document on the app's origin, so OPFS is reachable and the app finds
 * `workspaces.json` on its first boot: no welcome workspace, no storage
 * chooser, no double seed.
 */
export async function seedBeforeBoot(context) {
  const page = await context.newPage();
  await page.route(`${APP}/`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>seed</title>",
    }),
  );
  await page.goto(`${APP}/`, { waitUntil: "load", timeout: 60_000 });

  const ids = await seedWorkspace(page, { workspaceId: WORKSPACE_ID });

  await page.unroute(`${APP}/`);
  await page.close();

  return ids;
}

export async function applySettings(page, patch) {
  await page.evaluate((settings) => window.__typbase.store.updateSettings(settings), patch);
  // The structure listener re-applies the chrome theme and recompiles Typst.
  await page.waitForTimeout(900);
}

/** In-app navigation: no reload, so settings just applied stay in memory. */
export async function show(page, pageId, mode) {
  await page.evaluate(
    ({ id, viewMode }) => {
      window.__typbase.openPage(id);
      window.__typbase.setMode(viewMode);
    },
    { id: pageId, viewMode: mode },
  );

  await page.waitForSelector(".cm-editor", { timeout: 120_000 });
  await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 60_000 });
  await page.waitForTimeout(900);
  // The linter runs after the editor compile; wait for a clean gutter so no
  // red squiggles land in the shot.
  await page
    .waitForFunction(
      () => !document.querySelector(".cm-lintRange-error, .cm-lintRange-warning"),
      null,
      { timeout: 20_000 },
    )
    .catch(() => console.log("[warn] diagnostics still present"));
}

/** Moves the visible cursor to a locator and clicks it. */
export async function clickWithCursor(page, locator, options = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Locator has no box to click");

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 14 });
  await page.waitForTimeout(options.pause ?? 220);
  await page.mouse.click(x, y);
}

/** Center of the first text range containing `text` inside the editor. */
export async function tokenPoint(page, text) {
  return page.evaluate((needle) => {
    const root = document.querySelector(".cm-content");
    if (!root) return null;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const index = node.textContent.indexOf(needle);
      if (index === -1) continue;

      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }

    return null;
  }, text);
}

/** Moves the pointer over a token and holds it there for a hover popup. */
export async function hoverToken(page, text, wait = 1200) {
  const point = await tokenPoint(page, text);
  if (!point) return false;

  await page.mouse.move(point.x, point.y, { steps: 12 });
  await page.waitForTimeout(wait);

  return true;
}

/** Clicks a token, for placing the caret inside math. */
export async function clickToken(page, text, pause = 600) {
  const point = await tokenPoint(page, text);
  if (!point) return false;

  await page.mouse.move(point.x, point.y, { steps: 12 });
  await page.waitForTimeout(200);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(pause);

  return true;
}

/**
 * Accepts a completion by label. Assumes the popup is already open from
 * typing; retries with an explicit trigger if it is not. The engine ranks
 * completions by context, so the wanted item is not always the first.
 */
export async function acceptCompletion(page, labels) {
  const wanted = Array.isArray(labels) ? labels : [labels];

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await page.keyboard.press("Control+Space");

    await page
      .waitForFunction(
        () => document.querySelectorAll(".cm-tooltip-autocomplete li").length > 0,
        null,
        { timeout: 8000 },
      )
      .catch(() => {});

    const items = await page.evaluate(() =>
      [...document.querySelectorAll(".cm-tooltip-autocomplete li")].map(
        (item) => item.textContent?.trim() ?? "",
      ),
    );
    if (items.length === 0) continue;

    for (let step = 0; step < items.length + 2; step++) {
      const selected = await page.evaluate(
        () =>
          document
            .querySelector('.cm-tooltip-autocomplete li[aria-selected="true"]')
            ?.textContent?.trim() ?? null,
      );

      if (selected !== null && wanted.includes(selected)) {
        await page.keyboard.press("Enter");

        return true;
      }

      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(120);
    }

    await page.keyboard.press("Escape");
  }

  const seen = await page.evaluate(() =>
    [...document.querySelectorAll(".cm-tooltip-autocomplete li")].map(
      (item) => item.textContent?.trim() ?? "",
    ),
  );
  console.log(`[warn] completion ${wanted.join("/")} not found; saw: ${seen.join(", ")}`);

  return false;
}
