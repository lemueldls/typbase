// Generates typed lexicons into src/lexicons. Run after editing lexicons/.
// Both the protocol lexicons (com.atproto.*, app.bsky.*) and our own
// app.typbase.* come from the same `lex` build; the upstream copies live in
// lexicons/upstream and are refreshed from the atproto repo when the SDK alpha
// bumps.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

// The protocol calls the sync engine and publish flow use. Keep in sync with
// src/. Nothing outside this file should name a com.atproto.* NSID directly.
const include = [
  // spaces
  "com.atproto.simplespace.createSpace",
  "com.atproto.simplespace.getSpace",
  "com.atproto.space.getDelegationToken",
  "com.atproto.space.getSpaceCredential",
  "com.atproto.space.createRecord",
  "com.atproto.space.putRecord",
  "com.atproto.space.deleteRecord",
  "com.atproto.space.registerNotify",
  "com.atproto.space.listRepos",
  "com.atproto.space.listRepoOps",
  "com.atproto.space.getBlob",
  // public repo (publish, unpublished reads)
  "com.atproto.repo.uploadBlob",
  "com.atproto.repo.listRecords",
  "com.atproto.repo.getRecord",
  "com.atproto.repo.putRecord",
  "com.atproto.repo.deleteRecord",
  // profile display
  "app.bsky.actor.getProfile",
  // app lexicons
  "app.typbase.workspace",
  "app.typbase.config",
  "app.typbase.update",
  "app.typbase.snapshot",
  "app.typbase.asset",
  "app.typbase.post",
];

execFileSync(
  "lex",
  [
    "build",
    // One root: the CLI takes a single directory and walks it recursively,
    // so upstream and app lexicons both live under lexicons/.
    "--lexicons",
    resolve(ROOT, "lexicons"),
    "--out",
    resolve(ROOT, "packages/spaces/src/lexicons"),
    "--clear",
    "--index-file",
    "--import-ext",
    "",
    "--lib",
    "@atproto/lex-schema",
    "--include",
    ...include,
  ],
  { stdio: "inherit" },
);
