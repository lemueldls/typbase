import { defineLexicons, field, space } from "airspace/lexicon";

/**
 * The workspace space's record types, defined once and used for both the
 * permissioned space and the public repo. `update` and `snapshot` carry Loro
 * bytes as base64 (airspace records are JSON; the PDS caps records around a
 * megabyte). `post` is a note: the space record is the draft, `publish()`
 * copies it to the public repo at the same key.
 *
 * The space NSID is `at.typbase.workspace`; the key is the local workspace
 * id, so every workspace gets its own space under the signed-in account.
 */
export default defineLexicons("at.typbase", {
  update: {
    docId: field.text({ max: 200 }),
    update: field.text({ max: 100_000 }),
    version: field.text({ max: 100_000 }),
    createdAt: field.datetime().optional(),
  },
  snapshot: {
    docId: field.text({ max: 200 }),
    snapshot: field.text({ max: 100_000 }),
    version: field.text({ max: 100_000 }),
    createdAt: field.datetime().optional(),
  },
  post: {
    // The record key is the page id, not a TID.
    key: "any",
    title: field.text({ max: 400 }),
    summary: field.text({ max: 2000 }).optional(),
    html: field.blob({ accept: ["text/html"] }),
    pdf: field.blob({ accept: ["application/pdf"] }).optional(),
    source: field.text({ max: 100_000 }),
    sourceUri: field.text({ max: 2000 }),
    langs: field.list(field.text({ max: 16 })).optional(),
    tags: field.list(field.text({ max: 40 })).optional(),
    createdAt: field.datetime(),
    updatedAt: field.datetime(),
    /** Set on the public copy by `publish()`. */
    publishedAt: field.datetime().optional(),
  },
  workspace: space(["update", "snapshot", "post"], { name: "Typbase workspace" }),
});
