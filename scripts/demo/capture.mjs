import { chromium } from "playwright";

import {
  IMAGES,
  SHOT_SETTINGS,
  VIEWPORT,
  applySettings,
  boot,
  ensureDirs,
  installChromePreferences,
  seedBeforeBoot,
  show,
} from "./app.mjs";

/**
 * Captures the demo stills into docs/images/ against a running dev server.
 *
 *   pnpm dev                     # in another terminal
 *   node scripts/demo/capture.mjs [--only=notebook-hero]
 *
 * The workspace is built inside the app through its own storage package, so
 * every run starts from the same state. Each shot runs in its own theme and
 * sizing preset. Plugins are work in progress and not part of the demo. See
 * docs/demo.md.
 */

const argv = process.argv.slice(2);
const only = argv.find((arg) => arg.startsWith("--only="))?.split("=")[1];

async function shot(page, name) {
  await page.screenshot({ path: `${IMAGES}/${name}.png` });
  console.log(`captured ${name}.png`);
}

async function main() {
  await ensureDirs();

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  await installChromePreferences(context);

  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 300)));

  try {
    const ids = await seedBeforeBoot(context);
    await boot(page);

    const wanted = (name) => !only || only === name;

    if (wanted("notebook-hero")) {
      await applySettings(page, SHOT_SETTINGS["notebook-hero"]);
      await show(page, ids.attention, "notebook");
      await page.waitForSelector(".tb-cell-output:not(.tb-cell-output--empty)", {
        timeout: 60_000,
      });
      await page.waitForSelector(".tb-cell-output svg", { timeout: 60_000 });
      await page.waitForTimeout(400);
      await shot(page, "notebook-hero");
    }

    if (wanted("query-split")) {
      await applySettings(page, SHOT_SETTINGS["query-split"]);
      await show(page, ids.home, "split");
      await page.waitForSelector(".paged-preview svg", { timeout: 60_000 });
      await page.waitForTimeout(400);
      await shot(page, "query-split");
    }

    if (wanted("wysiwyg")) {
      await applySettings(page, SHOT_SETTINGS.wysiwyg);
      await show(page, ids.home, "write");
      await page.waitForSelector(".typst-render", { timeout: 60_000 });
      // Click a rendered block to reveal its source in place.
      const rendered = page.locator(".cm-content .typst-render");
      await rendered.nth(Math.min(1, (await rendered.count()) - 1)).click();
      await page.waitForTimeout(500);
      await shot(page, "wysiwyg");
    }
  } finally {
    await browser.close();
  }
}

await main();
