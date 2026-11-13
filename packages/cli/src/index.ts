#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";

import { initPlugin, initTheme } from "./init";
import {
  buildPluginFolder,
  publishPluginFolder,
  verifyPluginPath,
  writePluginBundle,
} from "./plugin";
import { publishThemeFile, verifyTheme } from "./theme";

const HELP = `typbase

Usage:
  typbase theme init [dir] [--name <name>] [--force]
  typbase theme verify <theme.json> [--strict] [--json]
  typbase theme publish <theme.json> --identifier <handle> [--release 1.0.0] [--slug <slug>]
  typbase plugin init [dir] [--name <name>] [--force]
  typbase plugin verify <dir|file.tbplugin> [--json]
  typbase plugin build <dir> [--out <dir>]
  typbase plugin publish <dir> --identifier <handle> [--slug <slug>]

Publishing accepts --password or ATP_PASSWORD, and --service or ATP_SERVICE.
The default service is https://bsky.social. Use an app password, not your
account password.
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
    json: { type: "boolean" },
    strict: { type: "boolean" },
    force: { type: "boolean" },
    name: { type: "string" },
    out: { type: "string" },
    identifier: { type: "string" },
    password: { type: "string" },
    service: { type: "string" },
    slug: { type: "string" },
    release: { type: "string" },
    changelog: { type: "string" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  if (values.version) {
    console.log("0.4.8");
    return;
  }
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }

  const [group, action, target] = positionals;
  if (group === "theme") {
    if (action === "init") {
      const dir = target ?? ".";
      const name = values.name ?? (path.basename(path.resolve(dir)) || "My theme");
      await initTheme(dir, name, values.force === true);
      console.log(`theme scaffold written to ${dir}`);
      return;
    }

    if (action === "verify") {
      if (!target) fail("theme verify needs a theme.json path");
      const result = await verifyTheme(target, {
        strict: values.strict === true,
      });
      if (values.json) printJson(result);
      else {
        console.log(`${result.ok ? "ok" : "failed"}  ${result.file}`);
        console.log(`name: ${result.name || "-"}`);
        console.log(`schema: ${result.schema || "-"}`);
        console.log(`size: ${result.size} bytes`);
        console.log(`sha256: ${result.hash || "-"}`);
        for (const warning of result.warnings) console.log(`warning: ${warning}`);
        for (const error of result.errors) console.error(`error: ${error}`);
      }
      if (!result.ok) process.exitCode = 1;
      return;
    }

    if (action === "publish") {
      if (!target) fail("theme publish needs a theme.json path");
      const result = await publishThemeFile(target, {
        identifier: values.identifier,
        password: values.password,
        service: values.service,
        slug: values.slug,
        version: values.release,
        changelog: values.changelog,
      });
      if (values.json) printJson(result);
      else {
        console.log(`published ${result.listingUri}`);
        console.log(`release ${result.releaseUri}`);
        console.log(`version ${result.version}`);
        console.log(`sha256 ${result.sha256}`);
      }
      return;
    }

    fail(`unknown theme command "${String(action)}"`);
  }

  if (group === "plugin") {
    if (action === "init") {
      const dir = target ?? ".";
      const name = values.name ?? (path.basename(path.resolve(dir)) || "My plugin");
      await initPlugin(dir, name, values.force === true);
      console.log(`plugin scaffold written to ${dir}`);
      return;
    }

    if (action === "verify") {
      if (!target) fail("plugin verify needs a folder or .tbplugin path");
      const result = await verifyPluginPath(target);
      if (values.json) printJson(result);
      else {
        console.log(`${result.ok ? "ok" : "failed"}  ${result.target}`);
        console.log(`size: ${result.size} bytes`);
        console.log(`sha256: ${result.hash ?? "-"}`);
        if (result.manifest) {
          console.log(
            `manifest: ${result.manifest.name} ${result.manifest.version} (${result.manifest.api})`,
          );
        }
        for (const warning of result.warnings) console.log(`warning: ${warning}`);
        for (const error of result.errors) console.error(`error: ${error}`);
      }
      if (!result.ok) process.exitCode = 1;
      return;
    }

    if (action === "build") {
      if (!target) fail("plugin build needs a folder");
      const out = await writePluginBundle(target, values.out ?? path.join(target, "dist"));
      const build = await buildPluginFolder(target);
      console.log(`wrote ${out}`);
      console.log(`size ${build.artifact.byteLength} bytes`);
      console.log(`sha256 ${build.hash}`);
      return;
    }

    if (action === "publish") {
      if (!target) fail("plugin publish needs a folder");
      const result = await publishPluginFolder(target, {
        identifier: values.identifier,
        password: values.password,
        service: values.service,
        slug: values.slug,
      });
      if (values.json) printJson(result);
      else {
        console.log(`published ${result.listingUri}`);
        console.log(`release ${result.releaseUri}`);
        console.log(`version ${result.version}`);
        console.log(`sha256 ${result.sha256}`);
      }
      return;
    }

    fail(`unknown plugin command "${String(action)}"`);
  }

  fail(`unknown command "${String(group)}"`);
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});
