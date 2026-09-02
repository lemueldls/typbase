import { defineEventHandler, getQuery, redirect } from "nitro/h3";

/**
 * OAuth redirect target. The browser OAuth client processes the params in
 * the SPA (init()) because the app is a client-side bundle; this route just
 * hands the query string to it. Keeping the redirect on a real path (not the
 * index page directly) lets PDSes and browsers treat it as a normal redirect.
 */
export default defineEventHandler((event) => {
  const query = getQuery(event);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") params.set(key, value);
  }
  const search = params.toString();

  return redirect(`/?${search}`, 302);
});
