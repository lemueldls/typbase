import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

import {
  SHOT_SETTINGS,
  applySettings,
  boot,
  installChromePreferences,
  seedBeforeBoot,
  show,
} from "./app.mjs";

/**
 * Google Play listing screenshots from the seeded demo workspace:
 *
 *   pnpm dev
 *   node scripts/demo/store.mjs [--device=phone|tablet7|tablet10] [--only=split]
 *
 * Sizes are portrait and inside Play's rules (320..3840 px a side, no wider
 * than 16:9): phone 1080x1920, 7" tablet 1200x1920, 10" tablet 1600x2560. The
 * PNGs come out 24-bit RGB with no alpha, which is what the console accepts.
 *
 * Output: docs/store/<device>/NN-<scene>.png, numbered in listing order.
 */

const OUT = new URL("../../docs/store/", import.meta.url).pathname;

const DEVICES = {
  phone: {
    dir: "play-phone",
    viewport: { width: 540, height: 960 }, // 1080x1920 at 2x
  },
  tablet7: {
    dir: "play-tablet-7",
    viewport: { width: 600, height: 960 }, // 1200x1920 at 2x
  },
  tablet10: {
    dir: "play-tablet-10",
    viewport: { width: 800, height: 1280 }, // 1600x2560 at 2x
    // The 769px breakpoint; 10" tablets get the sidebar shell.
    wide: true,
  },
};

const pause = (page, ms) => page.waitForTimeout(ms);

/** Newest daily note with prose. The seed leaves today blank on purpose. */
async function dailyWithProse(page) {
  return page.evaluate(async () => {
    const store = window.__typbase.store;
    const notes = store
      .listPages()
      .filter((note) => note.path.startsWith("daily/"))
      .sort((a, b) => b.path.localeCompare(a.path));

    for (const note of notes) {
      const text = await store.loadPageText(note.id);
      const prose = text
        .split("\n")
        .some((line) => line.trim() && !/^(=|Previous:|Next:)/.test(line.trim()));
      if (prose) return note.id;
    }

    return null;
  });
}

/**
 * Scenes run in this order. Each one leaves the page settled so the
 * screenshot lands after animations. `narrowOnly` skips scenes that only
 * make sense without the sidebar (the drawer toggle).
 */
const SCENES = [
  {
    id: "read",
    async run({ page, ids }) {
      await show(page, ids.home, "read", { editor: false });
      await page.waitForSelector(".paged-preview svg", { timeout: 60_000 });
      await pause(page, 700);
    },
  },
  {
    id: "write",
    async run({ page, ids }) {
      // WYSIWYG editing: inline math and a display equation render in place.
      await show(page, ids.fibonacci, "write");
      await page.waitForSelector(".typst-render", { timeout: 60_000 });
      await pause(page, 700);
    },
  },
  {
    id: "notebook",
    async run({ page, ids }) {
      await show(page, ids.attention, "notebook");
      await page.waitForSelector(".tb-cell-output svg", { timeout: 60_000 });
      await pause(page, 900);
    },
  },
  {
    id: "split",
    async run({ page, ids }) {
      await show(page, ids.fibonacci, "split");
      await page.waitForSelector(".paged-preview svg", { timeout: 60_000 });
      await pause(page, 700);
    },
  },
  {
    id: "daily",
    async run({ page }) {
      const id = await dailyWithProse(page);
      if (!id) throw new Error("no daily note with prose in the demo workspace");
      await show(page, id, "write");
      await pause(page, 700);
    },
  },
  {
    id: "search",
    async run({ page }) {
      await page.keyboard.press("Control+K");
      await page.waitForSelector(".search-palette-panel", { timeout: 15_000 });
      // A stopword matches prose across pages, so the result list has groups.
      await page.locator(".search-palette-panel input").fill("the");
      await page.waitForSelector(".search-palette-panel__result", { timeout: 60_000 });
      await pause(page, 700);
    },
    async cleanup({ page }) {
      await page.keyboard.press("Escape");
      await page.waitForSelector(".search-palette-panel", {
        state: "detached",
        timeout: 15_000,
      });
    },
  },
  {
    id: "drawer",
    narrowOnly: true,
    async run({ page, ids }) {
      await show(page, ids.home, "write");
      await page.locator(".app__nav-toggle").first().click();
      await pause(page, 700);
    },
  },
  {
    id: "dark",
    async run({ page, ids }) {
      await applySettings(page, SHOT_SETTINGS["query-split"]);
      await show(page, ids.fibonacci, "split");
      await page.waitForSelector(".paged-preview svg", { timeout: 60_000 });
      await pause(page, 900);
    },
  },
];

const argv = process.argv.slice(2);
const onlyDevice = argv.find((arg) => arg.startsWith("--device="))?.split("=")[1];
const onlyScene = argv.find((arg) => arg.startsWith("--only="))?.split("=")[1];

async function captureDevice(browser, device) {
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: 2,
    colorScheme: "light",
    // Touch and mobile viewports, so the app renders the layouts a tablet or
    // phone gets: the drawer below 769px, the search drawer sheet, no hover.
    isMobile: true,
    hasTouch: true,
  });
  await installChromePreferences(context);

  const ids = await seedBeforeBoot(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));

  await boot(page);
  await applySettings(page, SHOT_SETTINGS["notebook-hero"]);

  const planned = SCENES.filter((scene) => !scene.narrowOnly || !device.wide);
  const target = `${OUT}/${device.dir}/`;
  await mkdir(target, { recursive: true });

  for (const scene of planned.filter((entry) => !onlyScene || entry.id === onlyScene)) {
    const number = String(planned.indexOf(scene) + 1).padStart(2, "0");
    await scene.run({ page, ids });
    await page.screenshot({ path: `${target}${number}-${scene.id}.png` });
    await scene.cleanup?.({ page, ids });

    console.log(`captured ${device.dir}/${number}-${scene.id}.png`);
  }

  await context.close();
}

const browser = await chromium.launch();

try {
  for (const [name, device] of Object.entries(DEVICES)) {
    if (onlyDevice && onlyDevice !== name) continue;
    await captureDevice(browser, device);
  }
} finally {
  await browser.close();
}
