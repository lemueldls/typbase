import type { LocalState, WorkspaceStore } from "@typbase/storage";
import type { SiteDeployState, SiteSettings } from "@typbase/typing";

import {
  createPublicRepo,
  createWispDomains,
  deleteWispSite,
  publishStandardSite,
  publishWispSite,
  wispSiteUrl,
  type OAuthSession,
  type WispRequestTransport,
  type WispResponse,
} from "@typbase/spaces";
import { isTauri } from "@typbase/storage";

import type { AtprotoService } from "~/lib/atproto";
import type { SiteBuild } from "~/lib/site/build";

import { applyStandardRecords, buildSite, siteRkey } from "~/lib/site/build";

export type SitePublishStage = "build" | "standard" | "upload" | "manifest" | "done" | "unpublish";

export interface SitePublishProgress {
  stage: SitePublishStage;
  message: string;
  done?: number;
  total?: number;
}

export interface PublishSiteResult {
  deploy: SiteDeployState;
  build: SiteBuild;
  reused: number;
  uploaded: number;
  standardSkipped: string | null;
}

const hashKey = (did: string, key: string): string => `site:hashes:${did}:${key}`;

/**
 * Wisp's domain XRPC only sends CORS headers for its own origin. The browser
 * build sends the call through the proxy service, which forwards it from a
 * Worker. The native command already bypasses CORS and keeps the direct path.
 */
export function createWispDomainRequest(proxyUrl?: string): WispRequestTransport {
  const proxy = proxyUrl?.trim().replace(/\/+$/, "") ?? "";

  return async (request) => {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");

      return invoke<WispResponse>("wisp_request", {
        url: request.url,
        method: request.method,
        headers: request.headers ?? null,
        body: request.body ?? null,
      });
    }

    const target = proxy ? proxyWispUrl(proxy, request.url) : request.url;
    const response = await fetch(target, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    return { status: response.status, body: await response.text() };
  };
}

/** Wisp only serves its domain XRPC from its own origin, so send that one through the proxy. */
function proxyWispUrl(proxy: string, url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname !== "wisp.place") return url;

  const nsid = parsed.pathname.replace(/^\/xrpc\/?/, "");

  return `${proxy}/wisp/${nsid}${parsed.search}`;
}

export const wispDomainRequest = createWispDomainRequest();

/**
 * Builds the site from the workspace and publishes it to the signing account's
 * public repo. Wisp owns the hosting records; Standard.site owns discovery.
 * The Wisp manifest is written last, so a failure before that leaves the
 * previous site serving.
 */
export async function publishSite(
  store: WorkspaceStore,
  atproto: AtprotoService,
  options: {
    local?: LocalState;
    onProgress?: (progress: SitePublishProgress) => void;
  } = {},
): Promise<PublishSiteResult> {
  const progress = options.onProgress ?? (() => undefined);
  const session = atproto.requireSession();
  const did = session.did;
  const settings = store.getSettings();
  const site = settings.site;
  const key = siteRkey(site, settings.name || "site");

  if (site.wisp.publisherDid && site.wisp.publisherDid !== did) {
    throw new Error(
      `This site belongs to ${site.wisp.publisherDid}. Sign in as that account, or use the site dashboard to publish under the current account.`,
    );
  }

  const nextSite: SiteSettings = {
    ...site,
    wisp: { ...site.wisp, siteRkey: key },
  };
  const baseUrl =
    nextSite.wisp.domainStatus === "verified" && nextSite.wisp.customDomain
      ? `https://${nextSite.wisp.customDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`
      : nextSite.wisp.domainStatus === "verified" && nextSite.wisp.subdomain
        ? `https://${nextSite.wisp.subdomain}.wisp.place`
        : wispSiteUrl(did, key, nextSite.wisp.serviceUrl);
  if (!baseUrl) throw new Error("The site has no public URL yet.");

  progress({ stage: "build", message: "Rendering pages" });
  const build = await buildSite(store, nextSite, {
    baseUrl,
    did,
    onProgress: (done, total) =>
      progress({
        stage: "build",
        message: `Rendering pages`,
        done,
        total,
      }),
  });

  const repo = createPublicRepo(session, did);
  let standardSkipped: string | null = null;
  let standard: {
    publicationUri: string;
    publicationRkey: string;
    documentRkeys: Record<string, string>;
  } | null = null;

  if (nextSite.standard.enabled) {
    if (
      nextSite.wisp.domainStatus !== "verified" ||
      (!nextSite.wisp.customDomain && !nextSite.wisp.subdomain)
    ) {
      standardSkipped =
        "Standard.site records need a claimed subdomain or custom domain, so the shared Wisp URL was published without them.";
    } else {
      progress({ stage: "standard", message: "Writing publication records" });
      standard = await publishStandardSite(repo, {
        publication: {
          ...build.standard.publication,
          showInDiscover: nextSite.standard.showInDiscover,
        },
        documents: build.standard.documents,
        publicationRkey: nextSite.standard.publicationRkey,
        publicationUri: nextSite.standard.publicationUri,
        documentRkeys: nextSite.standard.documentRkeys,
      });
    }
  }

  if (!standard && nextSite.standard.publicationUri) {
    // Discovery is off, or the site moved back to the shared URL. Remove the
    // records so readers do not keep resolving an address that no longer
    // publishes Standard.site metadata.
    if (nextSite.standard.publicationRkey) {
      await repo
        .deleteRecord("site.standard.publication", nextSite.standard.publicationRkey)
        .catch(() => undefined);
    }
    for (const rkey of Object.values(nextSite.standard.documentRkeys)) {
      await repo.deleteRecord("site.standard.document", rkey).catch(() => undefined);
    }
  }

  const finalBuild = standard
    ? applyStandardRecords(
        build,
        standard.publicationUri,
        new Map(Object.entries(standard.documentRkeys)),
      )
    : build;

  if (standard) {
    // Persist the new record keys before the Wisp write. If the manifest write
    // fails, a retry updates the same records instead of creating duplicates.
    store.updateSettings({
      site: {
        ...nextSite,
        standard: {
          ...nextSite.standard,
          publicationRkey: standard.publicationRkey,
          publicationUri: standard.publicationUri,
          documentRkeys: standard.documentRkeys,
        },
      },
    });
  }

  progress({ stage: "upload", message: "Uploading files" });
  const previousHashes =
    (await options.local?.get<Record<string, string>>(hashKey(did, key))) ?? {};
  const published = await publishWispSite(repo, {
    siteRkey: key,
    files: finalBuild.files.map((file) => ({
      name: file.name,
      bytes: file.bytes,
      mimeType: file.mimeType,
    })),
    fileHashes: previousHashes,
    onProgress: (entry) => {
      if (entry.stage === "manifest") {
        progress({ stage: "manifest", message: "Writing Wisp manifest" });
        return;
      }
      progress({
        stage: "upload",
        message: `Uploading files`,
        done: entry.done,
        total: entry.total,
      });
    },
    settings: {
      cleanUrls: true,
      custom404: "404.html",
      indexFiles: ["index.html"],
      headers: [
        {
          name: "Cache-Control",
          value: "public, max-age=31536000, immutable",
          path: "/assets/*",
        },
        { name: "Cache-Control", value: "no-cache", path: "/assets/site.css" },
        { name: "Cache-Control", value: "no-cache", path: "/assets/site.js" },
        { name: "Cache-Control", value: "no-cache", path: "/assets/site-graph.js" },
        { name: "Cache-Control", value: "no-cache", path: "/fonts/MaterialSymbolsRounded.woff2" },
        { name: "Cache-Control", value: "no-cache", path: "/graph.json" },
        {
          name: "Cache-Control",
          value: "public, max-age=31536000, immutable",
          path: "/fonts/*",
        },
      ],
    },
  });

  if (options.local) await options.local.set(hashKey(did, key), published.hashes);

  const deploy: SiteDeployState = {
    url: baseUrl,
    wispUri: published.uri,
    manifestCid: published.cid,
    deployedAt: Date.now(),
    buildHash: finalBuild.hash,
    pageCount: finalBuild.pages.length,
    fileCount: published.fileCount,
    totalBytes: published.totalBytes,
    standardPublicationUri: standard?.publicationUri ?? null,
  };
  const updated: SiteSettings = {
    ...nextSite,
    wisp: {
      ...nextSite.wisp,
      siteRkey: key,
      publisherDid: did,
      lastDeploy: deploy,
    },
    standard: standard
      ? {
          ...nextSite.standard,
          publicationRkey: standard.publicationRkey,
          publicationUri: standard.publicationUri,
          documentRkeys: standard.documentRkeys,
        }
      : {
          ...nextSite.standard,
          publicationRkey: null,
          publicationUri: null,
          documentRkeys: {},
        },
  };
  store.updateSettings({ site: updated });
  progress({ stage: "done", message: "Published" });

  return {
    deploy,
    build: finalBuild,
    reused: published.reused,
    uploaded: published.uploaded,
    standardSkipped,
  };
}

/** Takes the site offline. The domain claim and the local configuration stay. */
export async function unpublishSite(
  store: WorkspaceStore,
  atproto: AtprotoService,
  request: WispRequestTransport = wispDomainRequest,
): Promise<void> {
  const session = atproto.requireSession();
  const site = store.getSiteSettings();
  const key = siteRkey(site, store.getSettings().name || "site");
  const repo = createPublicRepo(session, session.did);

  if (site.wisp.publisherDid && site.wisp.publisherDid !== session.did) {
    throw new Error(
      `This site belongs to ${site.wisp.publisherDid}. Sign in as that account to take it offline.`,
    );
  }

  const domains = createWispDomains(repo, site.wisp.serviceUrl, site.wisp.serviceDid, request);
  await domains.deleteSite(key).catch(() => undefined);
  await deleteWispSite(repo, key);

  const publicationRkey = site.standard.publicationRkey;
  if (publicationRkey) {
    await repo.deleteRecord("site.standard.publication", publicationRkey).catch(() => undefined);
  }
  for (const rkey of Object.values(site.standard.documentRkeys)) {
    await repo.deleteRecord("site.standard.document", rkey).catch(() => undefined);
  }

  store.updateSettings({
    site: {
      ...site,
      wisp: { ...site.wisp, siteRkey: key, lastDeploy: null },
      standard: {
        ...site.standard,
        publicationRkey: null,
        publicationUri: null,
        documentRkeys: {},
      },
    },
  });
}

export function wispClient(
  site: SiteSettings,
  session: OAuthSession,
  request: WispRequestTransport = wispDomainRequest,
) {
  const repo = createPublicRepo(session, session.did);

  return {
    repo,
    domains: createWispDomains(repo, site.wisp.serviceUrl, site.wisp.serviceDid, request),
    sharedUrl: (key: string) => wispSiteUrl(session.did, key, site.wisp.serviceUrl),
  };
}
