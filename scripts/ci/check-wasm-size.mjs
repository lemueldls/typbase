#!/usr/bin/env node

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const LIMIT = 25 * 1024 * 1024;
const targets = process.argv.slice(2);
if (targets.length === 0) targets.push("packages/engine/pkg/engine_bg.wasm");

function wasmFiles(target) {
  const stat = statSync(target);
  if (stat.isFile()) return target.endsWith(".wasm") ? [target] : [];

  const files = [];
  for (const entry of readdirSync(target, { recursive: true })) {
    const file = join(target, entry.toString());
    if (file.endsWith(".wasm") && statSync(file).isFile()) files.push(file);
  }

  return files;
}

let checked = 0;
let failed = false;
for (const target of targets) {
  let files;
  try {
    files = wasmFiles(target);
  } catch (cause) {
    console.error(`cannot read ${target}: ${cause.message}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error(`no .wasm files under ${target}`);
    process.exit(1);
  }

  for (const file of files) {
    checked += 1;
    const size = statSync(file).size;
    const mib = size / 1024 / 1024;
    if (size > LIMIT) {
      failed = true;
      console.error(`${file}: ${mib.toFixed(2)} MiB, over the 25 MiB static asset limit`);
    } else {
      const headroom = (LIMIT - size) / 1024 / 1024;
      console.log(`${file}: ${mib.toFixed(2)} MiB, ${headroom.toFixed(2)} MiB under the limit`);
    }
  }
}

if (failed) process.exit(1);
console.log(`checked ${checked} wasm file${checked === 1 ? "" : "s"}`);
