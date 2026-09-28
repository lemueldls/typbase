import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { chromium } from "playwright";

import {
  GIF_FILTER,
  IMAGES,
  SHOT_SETTINGS,
  VIDEOS,
  VIEWPORT,
  acceptCompletion,
  applySettings,
  boot,
  moveCursor,
  clickWithCursor,
  ensureDirs,
  hoverToken,
  installChromePreferences,
  installCursor,
  seedBeforeBoot,
  show,
} from "./app.mjs";

/**
 * Records the hero video: one unbroken walk through the app, notebook mode
 * excluded on purpose. Playwright records the whole page session including
 * the seed and boot; ffmpeg trims from the first staged frame using the wall
 * clock captured when the page was created.
 *
 *   pnpm dev
 *   node scripts/demo/hero.mjs
 *
 * Output: docs/video/hero.mp4, docs/images/hero.gif, and
 * docs/images/hero-poster.png.
 */

const exec = promisify(execFile);
const RAW = "/tmp/opencode/demo-video";

const pause = (page, ms) => page.waitForTimeout(ms);

async function clickMode(page, name) {
  await clickWithCursor(page, page.getByRole("tab", { name }));
  await pause(page, 700);
}

async function clickSidebar(page, text) {
  await clickWithCursor(page, page.locator(".sidebar__row").filter({ hasText: text }).first());
  // Read mode hides the editor, so wait for the page shell instead.
  await page.waitForSelector(".page-view", { timeout: 60_000 });
  await pause(page, 900);
}

/**
 * Screen point of a graph node once its position holds still, so a click
 * lands after the refit tween instead of chasing it. Null when the node is
 * not on the canvas.
 */
async function settledNodePoint(page, id, { timeout = 8000 } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;

  while (Date.now() < deadline) {
    const point = await page.evaluate(
      (nodeId) => window.__typbase.graphNodePoint?.(nodeId) ?? null,
      id,
    );
    if (!point) return null;
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 1.5) return point;

    last = point;
    await pause(page, 180);
  }

  return last;
}

async function main() {
  await ensureDirs();

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: "light",
    recordVideo: { dir: RAW, size: VIEWPORT },
  });
  await installChromePreferences(context);
  await installCursor(context);

  const ids = await seedBeforeBoot(context);

  const page = await context.newPage();
  // The seed ran in its own page, so this page's video opens on the app
  // boot. Remember the wall clock at creation: the trim below lands on the
  // first staged frame instead of a fixed offset.
  const videoStart = Date.now();
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));

  await boot(page);
  await applySettings(page, SHOT_SETTINGS["notebook-hero"]);

  const start = Date.now();

  try {
    // await titleCard(page);
    await show(page, ids.home, "write");
    await pause(page, 900);
    await clickMode(page, "Split");
    await pause(page, 900);

    // Navigate by clicking a page in the sidebar.
    await clickSidebar(page, "Fibonacci");
    await pause(page, 500);

    // Edit the example: count 8 to 12, table recomputes.
    const countLine = page.locator(".cm-line").filter({ hasText: "#let count = 8" }).first();
    await countLine.scrollIntoViewIfNeeded();
    await pause(page, 300);
    await clickWithCursor(page, countLine, { pause: 350 });
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("12", { delay: 140 });
    await pause(page, 1300);

    await hoverToken(page, "#count");

    // Write mode: completion from the document. Add a sentence that uses the
    // function defined above, so the edit reads like part of the note.
    await clickMode(page, "Write");
    await pause(page, 500);
    await page.evaluate(() => {
      const api = window.__typbase;
      const doc = api.view.state.doc.toString();

      api.view.dispatch({ selection: { anchor: doc.length } });
      api.view.focus();
    });
    await page.keyboard.press("Enter");
    await page.keyboard.type("The tenth number is #fib", { delay: 100 });
    await pause(page, 400);
    await acceptCompletion(page, "fib");
    await page.keyboard.type("(10).", { delay: 90 });
    await pause(page, 1000);
    // Make sure no completion popup lingers into the next scene.
    await page.keyboard.press("Escape");
    await pause(page, 400);

    // Hover info: the computed bindings, not just function docs.
    await hoverToken(page, "nums");
    await hoverToken(page, "fib");
    // Reveal the paragraph so its reference can be hovered too; the tooltip
    // resolves it to the current value.
    await page.evaluate(() => {
      const api = window.__typbase;
      const doc = api.view.state.doc.toString();

      api.view.dispatch({ selection: { anchor: doc.indexOf("are:") + 3 } });
      api.view.focus();
    });
    await pause(page, 500);
    // await hoverToken(page, "#count");

    // Math tooltips.
    await page.evaluate(() => {
      const api = window.__typbase;
      const doc = api.view.state.doc.toString();

      api.view.dispatch({ selection: { anchor: doc.indexOf("phi.alt") + 3 } });
      api.view.focus();
    });
    await hoverToken(page, "phi.alt", 300);
    await pause(page, 1400);
    await page.evaluate(() => {
      const api = window.__typbase;
      const doc = api.view.state.doc.toString();

      api.view.dispatch({ selection: { anchor: doc.indexOf("F_(n-1)") + 3 } });
      api.view.focus();
    });
    await pause(page, 1200);

    // Inline math at the end of the heading, so the rule just typed styles it.
    await page.evaluate(() => {
      const api = window.__typbase;
      const doc = api.view.state.doc.toString();
      const heading = "= Fibonacci sequence";

      api.view.dispatch({ selection: { anchor: doc.indexOf(heading) + heading.length } });
      api.view.focus();
    });
    await pause(page, 400);
    await page.keyboard.type(" $F_n$", { delay: 90 });
    await pause(page, 1300);

    // An inline show rule restyles the document as it is typed.
    const numbering = page
      .locator(".cm-line")
      .filter({ hasText: "#set heading(numbering" })
      .first();
    await numbering.scrollIntoViewIfNeeded();
    await clickWithCursor(page, numbering, { pause: 300 });
    await page.keyboard.press("Home");
    await pause(page, 900);
    await page.keyboard.press("Enter");
    await pause(page, 900);
    await page.keyboard.press("ArrowUp");
    await pause(page, 900);
    await page.keyboard.type("#show heading: set text(fill: theme.", { delay: 55 });
    await pause(page, 900);
    await page.keyboard.type("yellow)", { delay: 140 });
    // await page.keyboard.press("Enter");
    await pause(page, 1300);

    // Broken math while typing: the document keeps rendering, then heals.
    // The sentence is about the sequence, so the edit stays in context.
    await page.evaluate(() => {
      const api = window.__typbase;
      const doc = api.view.state.doc.toString();

      api.view.dispatch({ selection: { anchor: doc.length } });
      api.view.focus();
    });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("The ratio of consecutive terms approaches $phi.alt", {
      delay: 80,
    });
    await pause(page, 1600);
    await page.keyboard.type("$", { delay: 90 });
    await pause(page, 1100);
    await page.keyboard.type(" as $n$ grows.", { delay: 90 });
    await page.keyboard.press("Enter");
    await pause(page, 1200);

    // // Plain source and read views.
    // await clickMode(page, "Source");
    // await pause(page, 1100);
    // await clickMode(page, "Read");
    // await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    // await page.mouse.wheel(0, 500);
    // await pause(page, 1100);

    // Theme switch: Catppuccin, then dark mode.
    await clickWithCursor(page, page.locator('[aria-label="Workspace settings"]').first());
    await pause(page, 700);
    await clickWithCursor(
      page,
      page.locator(".settings__tab").filter({ hasText: "Appearance" }).first(),
    );
    await pause(page, 600);
    await clickWithCursor(page, page.getByRole("button", { name: "Catppuccin" }));
    await pause(page, 900);
    await clickWithCursor(page, page.getByRole("combobox", { name: "Theme mode" }));
    await pause(page, 400);
    await clickWithCursor(page, page.getByRole("option", { name: "Dark" }));
    await pause(page, 1400);
    await page.keyboard.press("Escape");
    await pause(page, 700);

    // Page links and backlinks: follow the daily note's Previous link, show
    // the backlinks panel, then open the workspace graph.
    await clickSidebar(page, "Today");
    await pause(page, 900);

    const pageLink = page.locator('a[href^="typbase://page/"]').first();
    await pageLink.waitFor({ timeout: 30_000 });
    await clickWithCursor(page, pageLink);
    await page.waitForSelector(".page-view", { timeout: 60_000 });
    await pause(page, 1300);

    await clickWithCursor(page, page.locator('[aria-label="More actions"]').first());
    await pause(page, 400);
    await clickWithCursor(page, page.getByRole("menuitem", { name: "Links" }));
    await page.waitForSelector(".links", { timeout: 15_000 }).catch(() => {});
    await pause(page, 1900);

    // The panel's hub button opens the graph rooted at the open page, which
    // flips local mode on. Uncheck it so the clip ends on the whole workspace.
    await clickWithCursor(page, page.locator('[aria-label="Open graph"]').first());
    await page.waitForSelector(".graph", { timeout: 15_000 }).catch(() => {});
    await moveCursor(page, VIEWPORT.width / 2, VIEWPORT.height / 2, { duration: 700 });
    await pause(page, 2200);

    await clickWithCursor(page, page.locator(".graph__toolbar .ui-switch__track"));
    // The node set grows, so the canvas refits once the layout settles.
    await pause(page, 2000);

    // Back home to close the loop: the Home node on the canvas, which opens
    // the page and dismisses the graph the way the sidebar row would.
    const homePoint = await settledNodePoint(page, ids.home);
    if (homePoint) {
      await moveCursor(page, homePoint.x, homePoint.y, { duration: 520 });
      await pause(page, 320);
      await page.mouse.click(homePoint.x, homePoint.y);
      await page.waitForSelector(".page-view", { timeout: 30_000 });
    } else {
      console.log("[warn] Home node not on the canvas; falling back to the sidebar");
      await clickSidebar(page, "Home");
    }
    await pause(page, 1500);

    await page.screenshot({ path: `${IMAGES}/hero-poster.png` });
  } finally {
    const end = Date.now();
    const video = page.video();
    await page.close();
    await context.close();

    await video.saveAs(`${RAW}/hero.webm`);
    await browser.close();

    const ss = Math.max(0, (start - videoStart) / 1000 - 0.35);
    const t = (end - start) / 1000 + 0.35 + 1.2;
    await exec("ffmpeg", [
      "-y",
      "-ss",
      ss.toFixed(2),
      "-t",
      t.toFixed(2),
      "-i",
      `${RAW}/hero.webm`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "22",
      "-movflags",
      "+faststart",
      `${VIDEOS}/hero.mp4`,
    ]);

    await exec("ffmpeg", [
      "-y",
      "-ss",
      ss.toFixed(2),
      "-t",
      t.toFixed(2),
      "-i",
      `${RAW}/hero.webm`,
      "-vf",
      GIF_FILTER,
      "-loop",
      "0",
      `${IMAGES}/hero.gif`,
    ]);

    const size = (await stat(`${VIDEOS}/hero.mp4`)).size / 1024 / 1024;
    const gifSize = (await stat(`${IMAGES}/hero.gif`)).size / 1024 / 1024;
    console.log(
      `captured hero.mp4 (${size.toFixed(1)} MB, ${t.toFixed(0)}s, trimmed ${ss.toFixed(1)}s of seed/boot) and hero.gif (${gifSize.toFixed(1)} MB)`,
    );
  }
}

await main();
