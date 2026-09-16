import type { WorkspaceStore } from "@typbase/storage";
import type { PublishSettings } from "@typbase/typing";

import type { AtprotoService } from "~/lib/atproto";

import { publishPrelude } from "~/lib/publishPrelude";
import { renderInWorker, setPublishRequestStore } from "~/lib/renderWorker";

export interface PublishOptions {
  /** Overrides the workspace publish defaults for this one publish. */
  langs?: string[];
  tags?: string[];
  includePdf?: boolean;
}

export interface PublishResult {
  uri: string;
  publishedAt: number;
}

/**
 * Renders a page and publishes it. The rendered artifacts become blobs on the
 * signed-in PDS; the `app.typbase.post` record is first written as a draft in
 * the workspace space and then copied to the public repo by airspace's
 * `publish()`, so a failed publish leaves the draft behind instead of a
 * half-written public record.
 */
export async function publishPage(
  store: WorkspaceStore,
  atproto: AtprotoService,
  pageId: string,
  options: PublishOptions = {},
): Promise<PublishResult> {
  const page = store.getPage(pageId);
  if (!page) throw new Error(`No page named ${pageId}`);

  const settings = store.getPublishSettings();
  const effective: Required<PublishSettings> = {
    langs: options.langs ?? settings.langs ?? [],
    tags: options.tags ?? settings.tags ?? [],
    includePdf: options.includePdf ?? settings.includePdf ?? false,
  };

  const source = await store.loadPageText(pageId);
  const appSettings = store.getSettings();

  setPublishRequestStore(store);
  const rendered = await renderInWorker({
    pagePath: page.path,
    source,
    prelude: publishPrelude(appSettings),
    wants: "html",
    spaceId: store.workspaceId,
  });
  if (!rendered.html) {
    throw new Error("Render produced no HTML; check the page diagnostics");
  }

  const airspace = atproto.requireWorkspace();
  const html = await airspace.blobs.upload(new TextEncoder().encode(rendered.html), {
    mimeType: "text/html",
  });

  let pdf: Awaited<ReturnType<typeof airspace.blobs.upload>> | undefined;
  if (effective.includePdf) {
    const renderedPdf = await renderInWorker({
      pagePath: page.path,
      source,
      prelude: publishPrelude(appSettings),
      wants: "pdf",
      spaceId: store.workspaceId,
    });
    if (renderedPdf.pdf) {
      pdf = await airspace.blobs.upload(renderedPdf.pdf, { mimeType: "application/pdf" });
    }
  }

  const now = new Date().toISOString();
  await airspace.workspace.post.put(pageId, {
    title: page.title,
    summary: summarize(source),
    html: html.blob,
    ...(pdf ? { pdf: pdf.blob } : {}),
    source,
    sourceUri: `${window.location.origin}/?page=${page.id}`,
    langs: effective.langs,
    tags: effective.tags,
    createdAt: now,
    updatedAt: now,
  });

  // The first publish has no public record to guard; later ones swap the CID
  // the reader just saw.
  const live = await airspace.post.get(pageId);
  const published = await airspace.workspace.post.publish(pageId, {
    ...(live ? { ifMatch: live.cid } : {}),
    transform: (value) => ({ ...value, publishedAt: now }),
  });

  const publishedAt = Date.now();
  await store.setPagePublished(pageId, publishedAt, published.uri);

  return { uri: published.uri, publishedAt };
}

export async function unpublishPage(
  store: WorkspaceStore,
  atproto: AtprotoService,
  pageId: string,
): Promise<void> {
  const page = store.getPage(pageId);
  if (!page) return;

  const airspace = atproto.requireWorkspace();
  await airspace.post.delete(pageId);
  await store.setPagePublished(pageId, null, null);
}

/** Plain-text summary: first paragraph-ish run, capped. */
export function summarize(source: string): string {
  const firstLine =
    source
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("=") && !line.startsWith("#")) ?? "";
  const plain = firstLine
    .replace(/[*_`$]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return plain.length > 400 ? `${plain.slice(0, 397)}...` : plain;
}
