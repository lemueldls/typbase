import type { WorkspaceStore } from "@typbase/storage";
import type { PageMeta } from "@typbase/typing";
import type { TypstState } from "@typbase/wasm";

import {
  escapeHtml,
  fileBase,
  fontFiles,
  inlineBlobs,
  styleExportHtml,
  type ExportFile,
  type ExportOptions,
} from "~/lib/exportPage";
import { publishPrelude, publishThemePalette } from "~/lib/publishPrelude";
import { renderInWorker, setPublishRequestStore, type RenderOutcome } from "~/lib/renderWorker";

export interface WorkspaceExportOptions extends ExportOptions {
  /** Write each selected page's artifacts under `pages/<slug>/`. */
  separate: boolean;
  /** Write one merged document from the selected pages. */
  combined: boolean;
}

export async function buildWorkspaceExport(
  store: WorkspaceStore,
  pageIds: string[],
  options: WorkspaceExportOptions,
  typstState?: TypstState,
): Promise<{ name: string; files: ExportFile[] }> {
  const pages = pageIds
    .map((id) => store.getPage(id))
    .filter((page): page is PageMeta => Boolean(page))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (!pages.length) throw new Error("Select at least one page.");
  if (!options.separate && !options.combined) {
    throw new Error("Choose per-page files, a combined document, or both.");
  }

  const themeOptions = { theme: options.theme, pageSize: options.pageSize } as const;
  const htmlPrelude = publishPrelude(store.getSettings(), { ...themeOptions, paged: false });
  const pagedPrelude = publishPrelude(store.getSettings(), { ...themeOptions, paged: true });
  const palette = publishThemePalette(store.getSettings(), themeOptions);
  const encoder = new TextEncoder();
  const files: ExportFile[] = [];
  const payloads = new Map<string, ExportFile>();
  const index: Array<{ title: string; href: string }> = [];

  const collect = (outcome: RenderOutcome): void => {
    for (const payload of outcome.payloads) {
      const bytes = payload.type === "file" ? payload.bytes : encoder.encode(payload.text);
      payloads.set(payload.path, { name: payload.path, bytes });
    }
  };

  setPublishRequestStore(store);

  const renderInto = async (input: {
    source: string;
    pagePath: string;
    stem: string;
    title?: string;
  }): Promise<void> => {
    const { source, pagePath, stem, title } = input;

    if (options.html) {
      const rendered = await renderInWorker({
        pagePath,
        source,
        prelude: htmlPrelude,
        wants: "html",
        spaceId: store.workspaceId,
      });
      if (!rendered.html) {
        throw new Error(`The render produced no HTML for ${pagePath}.`);
      }

      collect(rendered);
      files.push({
        name: `${stem}.html`,
        bytes: encoder.encode(styleExportHtml(await inlineBlobs(rendered.html, store), palette)),
      });
      if (title) index.push({ title, href: `${stem}.html` });
    }

    if (options.pdf) {
      const rendered = await renderInWorker({
        pagePath,
        source,
        prelude: pagedPrelude,
        wants: "pdf",
        spaceId: store.workspaceId,
      });
      if (!rendered.pdf) {
        throw new Error(`The render produced no PDF for ${pagePath}.`);
      }

      collect(rendered);
      files.push({ name: `${stem}.pdf`, bytes: rendered.pdf });
    }

    if (options.svg) {
      const rendered = await renderInWorker({
        pagePath,
        source,
        prelude: pagedPrelude,
        wants: "svg",
        merged: options.svgMerged,
        spaceId: store.workspaceId,
      });
      if (!rendered.svg?.length) {
        throw new Error(`The render produced no SVG pages for ${pagePath}.`);
      }

      collect(rendered);
      const many = rendered.svg.length > 1;
      rendered.svg.forEach((svg, sheet) => {
        files.push({
          name: `${stem}${many ? `-${sheet + 1}` : ""}.svg`,
          bytes: encoder.encode(svg),
        });
      });
    }

    if (options.project) {
      files.push({ name: `${stem}.typ`, bytes: encoder.encode(`${pagedPrelude}\n${source}`) });
    }
  };

  if (options.separate) {
    for (const page of pages) {
      const source = await store.loadPageText(page.id);
      const base = fileBase(page.title, page.path);
      await renderInto({
        source,
        pagePath: page.path,
        stem: `pages/${base}/${base}`,
        title: page.title,
      });
    }
  }

  if (options.combined) {
    const sources: string[] = [];
    for (const page of pages) {
      sources.push(await store.loadPageText(page.id));
    }

    // Paged targets get real page breaks; HTML has no paging, so a rule
    // separates the notes there. All daily notes make the document a diary.
    const paged = `${sources.join("\n#pagebreak(weak: true)\n")}\n`;
    const flowed = `${sources.join("\n\n#horizontalrule()\n\n")}\n`;
    const name = pages.every((page) => page.path.startsWith("daily/")) ? "daily" : "combined";

    if (options.html) {
      const rendered = await renderInWorker({
        pagePath: `${name}.typ`,
        source: flowed,
        prelude: htmlPrelude,
        wants: "html",
        spaceId: store.workspaceId,
      });
      if (!rendered.html) throw new Error("The combined render produced no HTML.");

      collect(rendered);
      files.push({
        name: `${name}.html`,
        bytes: encoder.encode(styleExportHtml(await inlineBlobs(rendered.html, store), palette)),
      });
      index.unshift({ title: name, href: `${name}.html` });
    }

    if (options.pdf) {
      const rendered = await renderInWorker({
        pagePath: `${name}.typ`,
        source: paged,
        prelude: pagedPrelude,
        wants: "pdf",
        spaceId: store.workspaceId,
      });
      if (!rendered.pdf) throw new Error("The combined render produced no PDF.");

      collect(rendered);
      files.push({ name: `${name}.pdf`, bytes: rendered.pdf });
    }

    if (options.svg) {
      const rendered = await renderInWorker({
        pagePath: `${name}.typ`,
        source: paged,
        prelude: pagedPrelude,
        wants: "svg",
        merged: options.svgMerged,
        spaceId: store.workspaceId,
      });
      if (!rendered.svg?.length) throw new Error("The combined render produced no SVG pages.");

      collect(rendered);
      const many = rendered.svg.length > 1;
      rendered.svg.forEach((svg, sheet) => {
        files.push({
          name: `${name}${many ? `-${sheet + 1}` : ""}.svg`,
          bytes: encoder.encode(svg),
        });
      });
    }

    files.push({ name: `${name}.typ`, bytes: encoder.encode(`${pagedPrelude}\n${paged}`) });
  }

  if (options.project) {
    if (typstState) {
      files.push({ name: "typbase/lib.typ", bytes: encoder.encode(typstState.typbaseLib()) });
    }
    for (const payload of payloads.values()) files.push(payload);
    if (options.fonts) files.push(...(await fontFiles()));
  }

  if (files.length > 1) {
    files.push({
      name: "README.md",
      bytes: encoder.encode(buildWorkspaceReadme(pages.length, options)),
    });
    if (index.length) {
      files.push({ name: "index.html", bytes: encoder.encode(buildWorkspaceIndex(index)) });
    }
  }

  return {
    name: pages.length === 1 ? fileBase(pages[0]!.title, pages[0]!.path) : "workspace",
    files,
  };
}

function buildWorkspaceIndex(entries: Array<{ title: string; href: string }>): string {
  const items = entries
    .map((entry) => `      <li><a href="${entry.href}">${escapeHtml(entry.title)}</a></li>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Workspace export</title>
    <style>
      body { margin: 0; padding: 2rem; font-family: system-ui, sans-serif; background: #f3f4f6; color: #1f2328; }
      ul { margin: 0; padding-left: 1.2rem; }
      li { margin-bottom: 0.35rem; }
    </style>
  </head>
  <body>
    <h1>Workspace export</h1>
    <ul>
${items}
    </ul>
  </body>
</html>
`;
}

function buildWorkspaceReadme(pageCount: number, options: WorkspaceExportOptions): string {
  const lines = [
    "# Workspace export",
    "",
    `${pageCount} page${pageCount === 1 ? "" : "s"}, exported ${new Date().toISOString()}.`,
    "",
    "## Files",
    "",
  ];

  if (options.separate) {
    lines.push(
      "- `pages/<slug>/`: each page's artifacts, plus its `.typ` with the prelude inlined",
    );
  }
  if (options.combined) {
    lines.push("- `combined.*` or `daily.*`: the selected pages merged into one document");
  }
  if (options.project) {
    lines.push("- `typbase/`: the library, referenced data and blobs, and optionally fonts");
  }
  lines.push("");

  if (options.project) {
    lines.push(
      "## Compiling the Typst source",
      "",
      "Compile from the extracted bundle root; the project imports `/typbase/lib.typ`:",
      "",
      "```sh",
      `typst compile --root .${options.fonts ? " --font-path typbase/fonts" : ""} pages/<slug>/<slug>.typ`,
      "```",
      "",
    );
  }

  return lines.join("\n");
}
