import { restoreCachedTheme } from "~/lib/themes";

/**
 * Pre-paint theme restore. The workspace doc is loaded asynchronously, so
 * waiting for it means one frame (or more) of the default theme. The last
 * applied settings are cached in localStorage by applyTheme; restoring them
 * here paints the correct palette before the first app frame, and the
 * workspace refresh refines it once the doc is open.
 */
export default defineNuxtPlugin(() => {
  restoreCachedTheme();
});
