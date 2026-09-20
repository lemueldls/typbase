import { execFile } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
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
  moveCursor,
  seedBeforeBoot,
  show,
  tokenPoint,
} from "./app.mjs";

/**
 * Records the demo clips into docs/images/*.gif (and docs/video/*.mp4) against
 * a running dev server.
 *
 *   pnpm dev                   # in another terminal
 *   node scripts/demo/clips.mjs [--only=typing]
 *
 * Playwright records the whole page session, including boot; the action window
 * is timed and ffmpeg trims to it. Raw webm files stay in /tmp.
 */

const exec = promisify(execFile);
const RAW = "/tmp/opencode/demo-video";

const argv = process.argv.slice(2);
const only = argv.find((arg) => arg.startsWith("--only="))?.split("=")[1];

async function convert(name, { ss, t }) {
  const webm = `${RAW}/${name}.webm`;
  const gif = `${IMAGES}/${name}.gif`;
  const mp4 = `${VIDEOS}/${name}.mp4`;

  await exec("ffmpeg", [
    "-y",
    "-ss",
    ss.toFixed(2),
    "-t",
    t.toFixed(2),
    "-i",
    webm,
    "-vf",
    "fps=13,scale=1200:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=160[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
    "-loop",
    "0",
    gif,
  ]);

  await exec("ffmpeg", [
    "-y",
    "-ss",
    ss.toFixed(2),
    "-t",
    t.toFixed(2),
    "-i",
    webm,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "22",
    "-movflags",
    "+faststart",
    mp4,
  ]);

  const gifSize = (await stat(gif)).size / 1024 / 1024;
  console.log(`captured ${name}.gif (${gifSize.toFixed(1)} MB) and ${name}.mp4`);
}

/** Records one clip: setup runs before `start`, only the action is kept. */
async function record(name, { stage, act }) {
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
  const createdAt = Date.now();
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));

  try {
    const ids = await seedBeforeBoot(context);
    await boot(page);
    await stage({ page, ids });

    const start = Date.now();
    await act({ page, ids });
    const end = Date.now();

    const video = page.video();
    await page.close();
    await context.close();

    await video.saveAs(`${RAW}/${name}.webm`);
    await convert(name, {
      ss: Math.max(0, (start - createdAt) / 1000 - 0.35),
      t: (end - start) / 1000 + 1.1,
    });
  } finally {
    await browser.close();
  }
}

const clips = {
  /** Type a sentence into a rendered paragraph, then let it render again. */
  typing: {
    stage: async ({ page, ids }) => {
      await applySettings(page, SHOT_SETTINGS["notebook-hero"]);
      await show(page, ids.home, "write");
      await page.waitForSelector(".typst-render", { timeout: 60_000 });
    },
    act: async ({ page }) => {
      // Click the paragraph (the heading is the first rendered block) to
      // reveal its source, type, then click the heading to render it again.
      await clickWithCursor(page, page.locator(".cm-content .typst-render").nth(1), {
        pause: 400,
      });
      await page.waitForTimeout(300);
      await page.keyboard.press("End");
      await page.keyboard.type(" It reads back what the app knows.", { delay: 45 });
      await page.waitForTimeout(700);
      await clickWithCursor(page, page.locator(".cm-content .typst-render").nth(0), {
        pause: 350,
      });
      await page.waitForTimeout(900);
    },
  },

  /** Run a cell, then edit it and watch the output follow along live. */
  "notebook-run": {
    stage: async ({ page, ids }) => {
      await applySettings(page, SHOT_SETTINGS["notebook-hero"]);
      await show(page, ids.attention, "notebook");
      await page.waitForSelector(".tb-cell-output svg", { timeout: 60_000 });
    },
    act: async ({ page }) => {
      await clickWithCursor(page, page.locator(".tb-cell-btn--run").nth(1), { pause: 350 });
      await page.waitForSelector(".tb-cell-counter", { timeout: 30_000 });
      await page.waitForTimeout(900);

      // Widen the bars: select the width value and replace it.
      const point = await tokenPoint(page, "0.35");
      if (point) await moveCursor(page, point.x, point.y, { duration: 380 });
      await page.waitForTimeout(250);
      await page.evaluate(() => {
        const view = window.__typbase.view;
        const doc = view.state.doc.toString();
        const index = doc.indexOf("0.35");

        view.dispatch({ selection: { anchor: index, head: index + "0.35".length } });
        view.focus();
      });
      await page.waitForTimeout(250);
      await page.keyboard.type("0.6", { delay: 120 });
      await page.waitForTimeout(1400);
    },
  },

  /** Click rendered blocks to jump into their source, back and forth. */
  "click-to-source": {
    stage: async ({ page, ids }) => {
      await applySettings(page, SHOT_SETTINGS.wysiwyg);
      await show(page, ids.home, "write");
      await page.waitForSelector(".typst-render", { timeout: 60_000 });
    },
    act: async ({ page }) => {
      for (const index of [0, 0, 1]) {
        const block = page.locator(".cm-content .typst-render").nth(index);
        if ((await block.count()) === 0) break;

        await clickWithCursor(page, block, { pause: 500 });
        await page.waitForTimeout(800);
      }
    },
  },

  /** Typst's README example: change count and watch the table recompute. */
  fibonacci: {
    stage: async ({ page, ids }) => {
      await applySettings(page, SHOT_SETTINGS["notebook-hero"]);
      await show(page, ids.fibonacci, "write");
      await page.waitForSelector(".typst-render", { timeout: 60_000 });
    },
    act: async ({ page }) => {
      const line = page.locator(".cm-line").filter({ hasText: "#let count = 8" }).first();
      await line.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await clickWithCursor(page, line, { pause: 400 });
      await page.keyboard.press("End");
      await page.keyboard.press("Backspace");
      await page.keyboard.type("12", { delay: 140 });
      await page.waitForTimeout(1600);
    },
  },

  /** Completion from the document: #fib is offered, then computes. */
  autocomplete: {
    stage: async ({ page, ids }) => {
      await applySettings(page, SHOT_SETTINGS["notebook-hero"]);
      await show(page, ids.fibonacci, "write");
      await page.waitForSelector(".typst-render", { timeout: 60_000 });
    },
    act: async ({ page }) => {
      await page.evaluate(() => {
        const api = window.__typbase;
        const doc = api.view.state.doc.toString();

        api.view.dispatch({ selection: { anchor: doc.length } });
        api.view.focus();
      });
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await page.keyboard.type("The tenth number is #fib", { delay: 100 });
      await page.waitForTimeout(400);
      await acceptCompletion(page, "fib");
      await page.keyboard.type("(10).", { delay: 90 });
      await page.waitForTimeout(900);
      // Dismiss the popup and leave the block so the sentence renders.
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        window.__typbase.view.dispatch({ selection: { anchor: 0 } });
        window.__typbase.view.focus();
      });
      await page.waitForTimeout(1300);
    },
  },

  /** Hover info on the computed bindings and a reference to one. */
  hover: {
    stage: async ({ page, ids }) => {
      await applySettings(page, SHOT_SETTINGS.wysiwyg);
      await show(page, ids.fibonacci, "write");
      await page.waitForSelector(".typst-render", { timeout: 60_000 });
    },
    act: async ({ page }) => {
      await hoverToken(page, "count");
      await hoverToken(page, "nums");
      // Reveal the paragraph, then hover the reference in it.
      await page.evaluate(() => {
        const api = window.__typbase;
        const doc = api.view.state.doc.toString();

        api.view.dispatch({ selection: { anchor: doc.indexOf("are:") + 3 } });
        api.view.focus();
      });
      await page.waitForTimeout(500);
      await hoverToken(page, "#count");
    },
  },

  /** Unclosed math while typing: the document keeps rendering, then heals. */
  recovery: {
    stage: async ({ page, ids }) => {
      await applySettings(page, SHOT_SETTINGS["query-split"]);
      await show(page, ids.fibonacci, "split");
      await page.waitForSelector(".paged-preview svg", { timeout: 60_000 });
    },
    act: async ({ page }) => {
      const line = page.locator(".cm-line").filter({ hasText: "The first" }).first();
      await line.scrollIntoViewIfNeeded();
      await clickWithCursor(page, line, { pause: 350 });
      await page.keyboard.press("End");
      await page.keyboard.type(" $x^2 + y^2", { delay: 80 });
      await page.waitForTimeout(1600);
      await page.keyboard.type("$", { delay: 90 });
      await page.waitForTimeout(1300);
    },
  },

  /** An inline show rule restyles the document as it is typed. */
  rules: {
    stage: async ({ page, ids }) => {
      await applySettings(page, SHOT_SETTINGS.wysiwyg);
      await show(page, ids.fibonacci, "split");
      await page.waitForSelector(".paged-preview svg", { timeout: 60_000 });
    },
    act: async ({ page }) => {
      const line = page.locator(".cm-line").filter({ hasText: "#set heading(numbering" }).first();
      await line.scrollIntoViewIfNeeded();
      await clickWithCursor(page, line, { pause: 350 });
      await page.keyboard.press("Home");
      await page.keyboard.press("Enter");
      await page.keyboard.press("ArrowUp");
      await page.keyboard.type("#show heading: set text(fill: red)", { delay: 55 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1500);
    },
  },

  /** Math tooltips: the caret inside math shows the rendered symbol. */
  "math-tooltip": {
    stage: async ({ page, ids }) => {
      await applySettings(page, SHOT_SETTINGS["notebook-hero"]);
      // Tooltips come from the WYSIWYG plugin, so this needs Write mode.
      await show(page, ids.fibonacci, "write");
      await page.waitForSelector(".typst-render", { timeout: 60_000 });
    },
    act: async ({ page }) => {
      // Reveal the block equation and put the caret on phi.alt.
      await page.evaluate(() => {
        const api = window.__typbase;
        const doc = api.view.state.doc.toString();
        api.view.dispatch({ selection: { anchor: doc.indexOf("phi.alt") + 3 } });
        api.view.focus();
      });
      await hoverToken(page, "phi.alt", 300);
      await page.waitForSelector(".typst-popup-render", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(1400);

      // Move to the inline math in the first paragraph.
      await page.evaluate(() => {
        const api = window.__typbase;
        const doc = api.view.state.doc.toString();
        api.view.dispatch({ selection: { anchor: doc.indexOf("F_(n-1)") + 3 } });
        api.view.focus();
      });
      await page.waitForTimeout(1400);
    },
  },

  /** Property access completion in inline and block math. */
  "math-completion": {
    stage: async ({ page, ids }) => {
      await applySettings(page, SHOT_SETTINGS["notebook-hero"]);
      await show(page, ids.lens, "write");
      await page.waitForSelector(".typst-render", { timeout: 60_000 });
    },
    act: async ({ page }) => {
      await page.evaluate(() => {
        const api = window.__typbase;
        const doc = api.view.state.doc.toString();
        api.view.dispatch({ selection: { anchor: doc.length } });
        api.view.focus();
      });

      // Write the lens equation itself.
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await page.keyboard.type("$ 1/f = 1/d_o + 1/d_i $", { delay: 80 });
      await page.waitForTimeout(900);

      // A ray, as block math: arrow.r completes from the property list.
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await page.keyboard.type("A ray parallel to the axis: $ arrow.r", { delay: 100 });
      await page.waitForTimeout(500);
      await acceptCompletion(page, ["r", "arrow.r"]);
      await page.keyboard.type(" $", { delay: 90 });
      await page.waitForTimeout(900);

      // Phase, as inline math: phi.al completes to phi.alt.
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Phase: $ phi.al", { delay: 100 });
      await page.waitForTimeout(500);
      await acceptCompletion(page, ["alt", "phi.alt"]);
      await page.keyboard.type(" $", { delay: 90 });

      // Leave the block so the finished document renders.
      await page.evaluate(() => {
        window.__typbase.view.dispatch({ selection: { anchor: 0 } });
        window.__typbase.view.focus();
      });
      await page.waitForTimeout(1400);
    },
  },
};

async function main() {
  await ensureDirs();
  await rm(RAW, { recursive: true, force: true });
  await mkdir(RAW, { recursive: true });

  for (const [name, clip] of Object.entries(clips)) {
    if (only && only !== name) continue;

    await record(name, clip);
  }
}

await main();
