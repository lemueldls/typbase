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
 * cursor. The overlay follows `mousemove`; `moveCursor` below dispatches real
 * moves over time, so the pointer glides instead of teleporting. The press
 * scale and ripple are CSS, driven by real mousedown/mouseup events.
 */
export async function installCursor(context) {
  await context.addInitScript(() => {
    const attach = () => {
      if (document.getElementById("__demo-cursor")) return;

      const cursor = document.createElement("div");
      cursor.id = "__demo-cursor";
      cursor.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M5.2 2.6 L5.2 19.2 L9.6 15.2 L12.3 21.4 L15.1 20.2 L12.4 14 L18.2 14 Z"
            fill="#ffffff"
            stroke="#1f2328"
            stroke-width="1.1"
            stroke-linejoin="round"
          />
        </svg>
        <span class="__demo-cursor-ring"></span>`;

      const style = document.createElement("style");
      style.textContent = `
        #__demo-cursor {
          position: fixed;
          left: 0;
          top: 0;
          width: 24px;
          height: 24px;
          z-index: 2147483647;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.18s ease;
          will-change: transform;
        }

        #__demo-cursor.is-visible {
          opacity: 1;
        }

        #__demo-cursor svg {
          display: block;
          width: 100%;
          height: 100%;
          overflow: visible;
          filter: drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.4));
          transform-origin: 5px 3px;
          transition: transform 90ms ease;
        }

        #__demo-cursor.is-pressed svg {
          transform: scale(0.82);
        }

        #__demo-cursor .__demo-cursor-ring {
          position: absolute;
          left: -1px;
          top: -1px;
          width: 26px;
          height: 26px;
          border: 2px solid rgb(31 35 40 / 0.35);
          border-radius: 50%;
          opacity: 0;
        }

        #__demo-cursor.is-clicked .__demo-cursor-ring {
          animation: __demo-cursor-ripple 320ms ease-out;
        }

        @keyframes __demo-cursor-ripple {
          from {
            opacity: 0.55;
            transform: scale(0.35);
          }

          to {
            opacity: 0;
            transform: scale(1.5);
          }
        }
      `;

      document.head.append(style);
      document.body.append(cursor);

      document.addEventListener(
        "mousemove",
        (event) => {
          // The overlay ignores events until `moveCursor` arms it. Chromium
          // reports a stray mousemove at (0,0) while the app boots, and
          // following it parked the pointer in the top-left corner before the
          // first glide started from the center.
          if (!window.__demoCursorArmed) return;

          cursor.classList.add("is-visible");
          cursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
        },
        true,
      );
      document.addEventListener(
        "mousedown",
        () => {
          if (window.__demoCursorArmed) cursor.classList.add("is-pressed");
        },
        true,
      );
      document.addEventListener(
        "mouseup",
        () => {
          if (!window.__demoCursorArmed) return;

          cursor.classList.remove("is-pressed");
          cursor.classList.remove("is-clicked");
          // Restart the ripple animation on every click.
          void cursor.offsetWidth;
          cursor.classList.add("is-clicked");
        },
        true,
      );
    };

    document.addEventListener("DOMContentLoaded", attach);
    if (document.body) attach();
  });
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Last animated pointer position, so moves start where the last one ended. */
let cursorPoint = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

/** Lets the overlay track the pointer; see the guard in `installCursor`. */
async function armCursor(page) {
  await page.evaluate(() => {
    window.__demoCursorArmed = true;
  });
}

/**
 * Moves the pointer to a point over `duration` ms along a slightly curved,
 * eased path, dispatching a real mousemove per frame. Playwright's built-in
 * `steps` all fire in one tick, which reads as a teleport on video.
 */
export async function moveCursor(page, x, y, { duration = 420 } = {}) {
  await armCursor(page);

  const from = cursorPoint;
  const dx = x - from.x;
  const dy = y - from.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 2) {
    await page.mouse.move(x, y);

    return;
  }

  // A gentle arc, like a hand moving a mouse: control point perpendicular to
  // the straight line, scaled by the distance.
  const bow = Math.min(distance * 0.12, 46) * (dx >= 0 ? 1 : -1);
  const control = {
    x: (from.x + x) / 2 + (-dy / distance) * bow,
    y: (from.y + y) / 2 + (dx / distance) * bow,
  };

  const started = Date.now();

  for (;;) {
    const t = Math.min(1, (Date.now() - started) / duration);
    const e = easeInOutCubic(t);
    const point = {
      x: (1 - e) ** 2 * from.x + 2 * (1 - e) * e * control.x + e ** 2 * x,
      y: (1 - e) ** 2 * from.y + 2 * (1 - e) * e * control.y + e ** 2 * y,
    };

    await page.mouse.move(point.x, point.y);
    cursorPoint = point;

    if (t >= 1) break;
    await page.waitForTimeout(12);
  }

  cursorPoint = { x, y };
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
export async function show(page, pageId, mode, { editor = true } = {}) {
  await page.evaluate(
    ({ id, viewMode }) => {
      window.__typbase.openPage(id);
      window.__typbase.setMode(viewMode);
    },
    { id: pageId, viewMode: mode },
  );

  // Read mode hides the editor, so it waits on the page shell instead.
  await page.waitForSelector(editor ? ".cm-editor" : ".page-view", { timeout: 120_000 });
  await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 60_000 });
  await page.waitForTimeout(900);
  if (!editor) return;
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

/** Glides the visible cursor to a locator and clicks it. */
export async function clickWithCursor(page, locator, options = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Locator has no box to click");

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await moveCursor(page, x, y, { duration: options.duration ?? 420 });
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

  await moveCursor(page, point.x, point.y, { duration: 380 });
  await page.waitForTimeout(wait);

  return true;
}

/** Clicks a token, for placing the caret inside math. */
export async function clickToken(page, text, pause = 600) {
  const point = await tokenPoint(page, text);
  if (!point) return false;

  await moveCursor(page, point.x, point.y, { duration: 380 });
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
