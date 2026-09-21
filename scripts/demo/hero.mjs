import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { chromium } from "playwright";

import {
  IMAGES,
  SHOT_SETTINGS,
  VIDEOS,
  VIEWPORT,
  acceptCompletion,
  applySettings,
  boot,
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
 * boot; ffmpeg trims to the staged sequence.
 *
 *   pnpm dev
 *   node scripts/demo/hero.mjs
 *
 * Output: docs/video/hero.mp4 and docs/images/hero-poster.png.
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

  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));

  const ids = await seedBeforeBoot(context);
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
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.type("#show heading: set text(fill: theme.", { delay: 55 });
    await pause(page, 1100);
    await page.keyboard.type("yellow)", { delay: 90 });
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

    await page.screenshot({ path: `${IMAGES}/hero-poster.png` });

    // Daily note and export dialog.
    await clickSidebar(page, "Today");
    await pause(page, 800);
    await clickWithCursor(page, page.locator('[aria-label="More actions"]').first());
    await pause(page, 400);
    await clickWithCursor(page, page.getByRole("menuitem", { name: "Export page" }));
    await page.waitForSelector(".export", { timeout: 15_000 }).catch(() => {});
    await pause(page, 1500);
    await page.keyboard.press("Escape");
    await pause(page, 600);

    // Back home to close the loop.
    await clickSidebar(page, "Home");
    await pause(page, 1500);
  } finally {
    const end = Date.now();
    const video = page.video();
    await page.close();
    await context.close();

    await video.saveAs(`${RAW}/hero.webm`);
    await browser.close();

    const ss = 0.4;
    const t = (end - start) / 1000 + 1.2;
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

    const size = (await stat(`${VIDEOS}/hero.mp4`)).size / 1024 / 1024;
    console.log(`captured hero.mp4 (${size.toFixed(1)} MB, ${t.toFixed(0)}s)`);
  }
}

await main();
