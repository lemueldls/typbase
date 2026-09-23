import type { TypstState } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";
import type { PageMeta } from "@typbase/typing";

import { stripCellMarkers } from "@typbase/codemirror";

import {
  escapeHtml,
  fileBase,
  fontFiles,
  inlineBlobs,
  styleExportHtml,
  type ExportFile,
  type ExportOptions,
} from "~/lib/exportPage";
import { publishPrelude, publishSyntaxTheme, publishThemePalette } from "~/lib/publishPrelude";
import { renderInWorker, setPublishRequestStore, type RenderOutcome } from "~/lib/renderWorker";

export interface WorkspaceExportOptions extends ExportOptions {
  /** Write each selected page's source and artifacts. */
  separate: boolean;
  /** Write one merged document from the selected pages. */
  combined: boolean;
}

/**
 * Bundle stem for a page's rendered artifacts. Sources keep their `page.path`;
 * renders live under `artifacts/` so the two never collide.
 */
function artifactStem(path: string): string {
  return `artifacts/${path.replace(/\.typ$/i, "")}`;
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
  const htmlPrelude = await publishPrelude(store.getSettings(), { ...themeOptions, paged: false });
  const pagedPrelude = await publishPrelude(store.getSettings(), { ...themeOptions, paged: true });
  const palette = publishThemePalette(store.getSettings(), themeOptions);
  const encoder = new TextEncoder();
  const files: ExportFile[] = [];
  const names = new Set<string>();
  const payloads = new Map<string, ExportFile>();
  const index: Array<{ title: string; href: string }> = [];

  const addFile = (file: ExportFile): void => {
    if (names.has(file.name)) {
      throw new Error(`Two exported files would both be named ${file.name}; rename one page.`);
    }

    names.add(file.name);
    files.push(file);
  };

  const collect = (outcome: RenderOutcome): void => {
    for (const payload of outcome.payloads) {
      // Packages were installed into the worker's world; the exported project
      // references them by spec instead of vendoring the tarball.
      if (payload.type === "package") continue;

      const bytes = payload.type === "file" ? payload.bytes : encoder.encode(payload.text);
      payloads.set(payload.path, { name: payload.path, bytes });
    }
  };

  setPublishRequestStore(store);

  const renderInto = async (input: {
    source: string;
    /** Virtual page path handed to the renderer. */
    pagePath: string;
    /** Bundle path of the source file, mirroring the workspace tree. */
    sourceName: string;
    /** Artifact stem under `artifacts/`; sheet suffixes are appended. */
    stem: string;
    title?: string;
  }): Promise<void> => {
    const { source, pagePath, sourceName, stem, title } = input;

    if (options.html) {
      const rendered = await renderInWorker({
        pagePath,
        source,
        prelude: htmlPrelude,
        wants: "html",
        spaceId: store.workspaceId,
        theme: palette,
      });
      if (!rendered.html) {
        throw new Error(`The render produced no HTML for ${pagePath}.`);
      }

      collect(rendered);
      addFile({
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
        theme: palette,
      });
      if (!rendered.pdf) {
        throw new Error(`The render produced no PDF for ${pagePath}.`);
      }

      collect(rendered);
      addFile({ name: `${stem}.pdf`, bytes: rendered.pdf });
    }

    if (options.svg) {
      const rendered = await renderInWorker({
        pagePath,
        source,
        prelude: pagedPrelude,
        wants: "svg",
        merged: options.svgMerged,
        spaceId: store.workspaceId,
        theme: palette,
      });
      if (!rendered.svg?.length) {
        throw new Error(`The render produced no SVG pages for ${pagePath}.`);
      }

      collect(rendered);
      const many = rendered.svg.length > 1;
      rendered.svg.forEach((svg, sheet) => {
        addFile({
          name: `${stem}${many ? `-${sheet + 1}` : ""}.svg`,
          bytes: encoder.encode(svg),
        });
      });
    }

    if (options.project) {
      const projectSource = options.stripMarkers ? stripCellMarkers(source) : source;
      addFile({
        name: sourceName,
        bytes: encoder.encode(`${pagedPrelude}\n${projectSource}`),
      });
    }
  };

  if (options.separate) {
    for (const page of pages) {
      const source = await store.loadPageText(page.id);
      await renderInto({
        source,
        pagePath: page.path,
        sourceName: page.path,
        stem: artifactStem(page.path),
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
    const pagePath = `${name}.typ`;
    const stem = `artifacts/${name}`;

    if (options.html) {
      const rendered = await renderInWorker({
        pagePath,
        source: flowed,
        prelude: htmlPrelude,
        wants: "html",
        spaceId: store.workspaceId,
        theme: palette,
      });
      if (!rendered.html) throw new Error("The combined render produced no HTML.");

      collect(rendered);
      addFile({
        name: `${stem}.html`,
        bytes: encoder.encode(styleExportHtml(await inlineBlobs(rendered.html, store), palette)),
      });
      index.unshift({ title: name, href: `${stem}.html` });
    }

    if (options.pdf) {
      const rendered = await renderInWorker({
        pagePath,
        source: paged,
        prelude: pagedPrelude,
        wants: "pdf",
        spaceId: store.workspaceId,
        theme: palette,
      });
      if (!rendered.pdf) throw new Error("The combined render produced no PDF.");

      collect(rendered);
      addFile({ name: `${stem}.pdf`, bytes: rendered.pdf });
    }

    if (options.svg) {
      const rendered = await renderInWorker({
        pagePath,
        source: paged,
        prelude: pagedPrelude,
        wants: "svg",
        merged: options.svgMerged,
        spaceId: store.workspaceId,
        theme: palette,
      });
      if (!rendered.svg?.length) throw new Error("The combined render produced no SVG pages.");

      collect(rendered);
      const many = rendered.svg.length > 1;
      rendered.svg.forEach((svg, sheet) => {
        addFile({
          name: `${stem}${many ? `-${sheet + 1}` : ""}.svg`,
          bytes: encoder.encode(svg),
        });
      });
    }

    if (options.project) {
      const combined = options.stripMarkers ? stripCellMarkers(paged) : paged;
      addFile({ name: pagePath, bytes: encoder.encode(`${pagedPrelude}\n${combined}`) });
    }
  }

  if (options.project) {
    if (typstState) {
      addFile({ name: "typbase/lib.typ", bytes: encoder.encode(typstState.typbaseLib()) });
    }
    const syntax = await publishSyntaxTheme(store.getSettings(), themeOptions);
    addFile({ name: syntax.path, bytes: encoder.encode(syntax.text) });
    for (const payload of payloads.values()) addFile(payload);
    if (options.fonts) {
      for (const font of await fontFiles()) addFile(font);
    }
  }

  if (files.length > 1) {
    addFile({
      name: "README.md",
      bytes: encoder.encode(buildWorkspaceReadme(pages.length, options)),
    });
    if (index.length) {
      addFile({ name: "index.html", bytes: encoder.encode(buildWorkspaceIndex(index)) });
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
      "- `artifacts/`: rendered HTML, PDF, and SVG, mirroring each page's path",
      "- `pages/`, `daily/`, ...: the page sources with the workspace prelude inlined",
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
      "Compile from the extracted bundle root; the prelude imports `/typbase/lib.typ`:",
      "",
      "```sh",
      `typst compile --root .${options.fonts ? " --font-path typbase/fonts" : ""} pages/<page.path>`,
      "```",
      "",
      'Tinymist needs the same root (`"tinymist.typstExtraArgs": ["--root", "."]`), because',
      "the prelude's import is root-absolute.",
      "",
    );
  }

  return lines.join("\n");
}
