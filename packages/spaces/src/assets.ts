import type { OAuthSession } from "@atproto/oauth-client-browser";

import type { WorkspaceClient } from "./client";

/** The kinds the asset browser and sync report. */
export type AssetKind = "font" | "image" | "file";

/** One content-addressed file in a workspace space. */
export interface AssetRecord {
  /** Full SHA-256 digest. Also the record key. */
  hash: string;
  /** The workspace blob id the app uses in page sources and settings. */
  address: string;
  cid: string;
  mime: string;
  size: number;
  kind: AssetKind;
  blob: unknown;
  createdAt: string;
}

/** The fields known before the PDS returns a blob ref. */
export type AssetUpload = Omit<AssetRecord, "blob" | "cid" | "createdAt">;

/** The network side of asset sync. Tests replace this with a memory store. */
export interface AssetRemote {
  list(): Promise<AssetRecord[]>;
  get(hash: string): Promise<AssetRecord | null>;
  upload(asset: AssetUpload, bytes: Uint8Array): Promise<AssetRecord>;
  download(asset: AssetRecord): Promise<Uint8Array>;
}

function assetKind(value: unknown): AssetKind {
  return value === "font" || value === "image" ? value : "file";
}

function toAssetRecord(value: unknown, key?: string): AssetRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<AssetRecord>;
  const hash = typeof raw.hash === "string" && raw.hash ? raw.hash : (key ?? "");
  if (!hash || !raw.blob) return null;

  return {
    hash,
    address: typeof raw.address === "string" && raw.address ? raw.address : hash,
    cid: typeof raw.cid === "string" ? raw.cid : "",
    mime: typeof raw.mime === "string" && raw.mime ? raw.mime : "application/octet-stream",
    size: typeof raw.size === "number" ? raw.size : 0,
    kind: assetKind(raw.kind),
    blob: raw.blob,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
  };
}

/**
 * Reads and writes asset records in the workspace space. Uploads go through
 * the PDS blob endpoint, and the record keeps the blob alive and permissioned
 * by the space. Downloads use the session fetch handler so the space ACL and
 * DPoP check both run.
 */
export function createAssetRemote(client: WorkspaceClient, session: OAuthSession): AssetRemote {
  return {
    async list() {
      const records: AssetRecord[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.workspace.asset.page({
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        for (const record of page.records) {
          const asset = toAssetRecord(record.value, String(record.rkey));
          if (asset) records.push(asset);
        }
        cursor = page.cursor ?? undefined;
      } while (cursor);

      return records;
    },

    async get(hash) {
      const record = await client.workspace.asset.get(hash);
      return record ? toAssetRecord(record.value, hash) : null;
    },

    async upload(asset, bytes) {
      const existing = await this.get(asset.hash);
      if (existing) return existing;

      const uploaded = await client.blobs.upload(bytes, { mimeType: asset.mime });
      const createdAt = new Date().toISOString();
      const value = {
        ...asset,
        cid: uploaded.cid,
        blob: uploaded.blob,
        createdAt,
      };
      await client.workspace.asset.put(asset.hash, value);

      return { ...value, kind: assetKind(value.kind) };
    },

    async download(asset) {
      const url = await client.workspace.blobs.url(asset.blob);
      if (!url) throw new Error(`Asset ${asset.hash} has no blob URL`);

      const response = await session.fetchHandler(url);
      if (!response.ok) {
        throw new Error(`Asset ${asset.hash} download failed (${response.status})`);
      }

      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
