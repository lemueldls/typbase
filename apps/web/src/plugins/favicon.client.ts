import favicon from "~~/public/favicon.svg?url";

/**
 * The public-dir favicon URL 404s in the dev server (Vite intercepts `.svg`
 * requests before the static handler), so point the tab icon at the bundled
 * asset URL instead. Production gets the same hashed URL.
 */
export default defineNuxtPlugin(() => {
  useHead({ link: [{ rel: "icon", type: "image/svg+xml", href: favicon }] });
});
