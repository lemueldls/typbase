import type { WorkspaceStore } from "@typbase/storage";
import type { PublishSettings } from "@typbase/typing";

import {
  POST_COLLECTION,
  Client,
  deletePublicRecord,
  listPublicRecords,
  putPublicRecord,
  uploadBlob,
  type BlobRef,
  type PublicRecord,
} from "@typbase/spaces";

import type { AtprotoService } from "~/lib/atproto";

import { publishPrelude } from "~/lib/publishPrelude";
import { renderInWorker, setPublishRequestStore } from "~/lib/renderWorker";

/**
 * Publish a page to public atproto: render HTML (optionally PDF) in the
 * worker, upload blobs, write `app.typbase.post` to the author's own repo
 * with the page id as rkey (so re-publishing overwrites). The record is the
 * canonical pointer; unpublish deletes it.
 *
 * Public means public: firehose mirrors may retain copies after unpublish,
 * and the UI says so before you click.
 */

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

  const session = await atproto.requireSession();
  const client = new Client(session);

  const htmlBlob = await uploadBlob(session, new TextEncoder().encode(rendered.html), "text/html");

  let pdfBlob: BlobRef | undefined;
  if (effective.includePdf) {
    const pdf = await renderInWorker({
      pagePath: page.path,
      source,
      prelude: publishPrelude(appSettings),
      wants: "pdf",
      spaceId: store.workspaceId,
    });
    if (pdf.pdf) {
      pdfBlob = await uploadBlob(session, pdf.pdf, "application/pdf");
    }
  }

  const now = new Date().toISOString();
  const record = {
    title: page.title,
    summary: summarize(source),
    html: htmlBlob,
    ...(pdfBlob ? { pdf: pdfBlob } : {}),
    source,
    sourceUri: `${window.location.origin}/?page=${page.id}`,
    langs: effective.langs,
    tags: effective.tags,
    createdAt: now,
    updatedAt: now,
  };

  const result = await putPublicRecord(client, {
    repoDid: session.did,
    collection: POST_COLLECTION,
    rkey: page.id,
    record,
  });

  const publishedAt = Date.now();
  await store.setPagePublished(pageId, publishedAt, result.uri);

  return { uri: result.uri, publishedAt };
}

export async function unpublishPage(
  store: WorkspaceStore,
  atproto: AtprotoService,
  pageId: string,
): Promise<void> {
  const page = store.getPage(pageId);
  if (!page) return;

  const session = await atproto.requireSession();
  const client = new Client(session);
  await deletePublicRecord(client, {
    repoDid: session.did,
    collection: POST_COLLECTION,
    rkey: page.id,
  });
  await store.setPagePublished(pageId, null, null);
}

/** Reads one user's published posts (public profile page). */
export async function fetchPublishedPosts(
  did: string,
  pdsUrl: string,
): Promise<Array<{ uri: string; cid: string | null; value: Record<string, unknown> }>> {
  const client = new Client({ service: pdsUrl });
  const all: Array<{
    uri: string;
    cid: string | null;
    value: Record<string, unknown>;
  }> = [];
  let cursor: string | null = null;
  do {
    // The do-while makes the generic inference circular; annotate the row
    // type so `page` is not typed from its own usage below.
    const page: {
      records: PublicRecord[];
      cursor: string | null;
    } = await listPublicRecords(client, {
      repoDid: did,
      collection: POST_COLLECTION,
      cursor,
    });
    all.push(
      ...page.records.map((record) => ({
        ...record,
        value: record.value as Record<string, unknown>,
      })),
    );
    cursor = page.cursor;
  } while (cursor);

  return all;
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
