import sqlite3InitModule from "sqlite-wasm-vec";

/**
 * Search index worker. Owns `index.sqlite` (OPFS when cross-origin isolation
 * allows it, memory otherwise) with FTS5 plus an optional sqlite-vec table
 * for semantic search. The main thread sends flattened blocks (see the wasm
 * `flattenDocument` pass) and asks queries here; all text search state lives
 * in this worker and nowhere else.
 */

export interface IndexedBlock {
  kind: string;
  plain: string;
  rangeStart: number;
  rangeEnd: number;
  /** raw byte offset per plain byte, as a plain number array over the wire */
  map: number[];
}

export interface SearchHit {
  docId: string;
  path: string;
  title: string;
  blockIndex: number;
  kind: string;
  plain: string;
  rangeStart: number;
  rangeEnd: number;
  /** FTS offsets within plain: [start, end] pairs. */
  offsets: Array<[number, number]>;
  bm25: number;
  semantic?: number;
}

export interface IndexStatus {
  mode: "opfs" | "memory";
  docs: number;
  blocks: number;
  vecReady: boolean;
}

type WorkerRequest =
  | { type: "init"; dbName: string }
  | {
      type: "upsert";
      docId: string;
      path: string;
      title: string;
      updatedAt: number;
      blocks: IndexedBlock[];
    }
  | { type: "delete"; docId: string }
  | { type: "query"; text: string; limit: number }
  | { type: "semantic-query"; vector: number[]; limit: number }
  | { type: "put-vector"; blockId: number; vector: number[] }
  | { type: "vectors-for"; docId: string }
  | { type: "status" }
  | { type: "wipe" };

type WorkerResponse = {
  id?: number;
  type: "status" | "query" | "semantic-query" | "vectors" | "upserted" | "error";
  status?: IndexStatus;
  hits?: SearchHit[];
  blockIds?: number[];
  docId?: string;
  vectors?: Array<{ blockId: number; vector: number[] }>;
  error?: string;
};

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
// sqlite3.oo1.DB is the constructor; the instance is what we hold.
type SqliteDb = InstanceType<Sqlite3["oo1"]["DB"]>;

let sqlite3: Sqlite3 | undefined;
let db: SqliteDb | undefined;
let mode: "opfs" | "memory" = "memory";
let vecReady = false;

async function ensureDb(dbName: string): Promise<void> {
  if (db) return;

  sqlite3 = await sqlite3InitModule();
  // OpfsDb is installed only when the OPFS VFS is available (see the
  // package docs); `"opfs" in sqlite3` never matches because the property
  // lives on sqlite3.oo1.
  const hasOpfs = "OpfsDb" in sqlite3.oo1;
  mode = hasOpfs ? "opfs" : "memory";
  const opened = hasOpfs
    ? new sqlite3.oo1.OpfsDb(`/typbase-${dbName}.sqlite3`)
    : new sqlite3.oo1.DB(`:memory:`);
  db = opened;

  opened.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS pages(
      doc_id TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS blocks(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id TEXT NOT NULL, block_index INTEGER NOT NULL,
      kind TEXT NOT NULL, plain TEXT NOT NULL,
      range_start INTEGER NOT NULL, range_end INTEGER NOT NULL,
      map BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS blocks_doc ON blocks(doc_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(plain);
  `);
  try {
    opened.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec USING vec0(embedding float[384])`);
    vecReady = true;
  } catch {
    // sqlite-vec unavailable in this build: semantic search degrades to FTS.
    vecReady = false;
  }
}

async function handle(request: WorkerRequest): Promise<void> {
  if (request.type === "init") {
    await ensureDb(request.dbName);
    post({ type: "status", status: status() });
    return;
  }

  if (!db) throw new Error("Index worker not initialized");

  switch (request.type) {
    case "upsert": {
      const blockIds: number[] = [];
      db.exec("BEGIN");
      try {
        db.exec("DELETE FROM fts WHERE rowid IN (SELECT id FROM blocks WHERE doc_id = ?)", {
          bind: [request.docId],
        });
        db.exec("DELETE FROM blocks WHERE doc_id = ?", { bind: [request.docId] });
        db.exec(
          "INSERT INTO pages(doc_id, path, title, updated_at) VALUES(?, ?, ?, ?) " +
            "ON CONFLICT(doc_id) DO UPDATE SET path=excluded.path, title=excluded.title, updated_at=excluded.updated_at",
          {
            bind: [request.docId, request.path, request.title, request.updatedAt],
          },
        );
        for (const [i, block] of request.blocks.entries()) {
          if (!block.plain.trim()) continue;
          const ids = db.selectArrays(
            "INSERT INTO blocks(doc_id, block_index, kind, plain, range_start, range_end, map) VALUES(?, ?, ?, ?, ?, ?, ?) RETURNING id",
            [
              request.docId,
              i,
              block.kind,
              block.plain,
              block.rangeStart,
              block.rangeEnd,
              packMap(block.map),
            ],
          );
          const rowid = Number(ids[0]?.[0]);
          if (rowid > 0) {
            db.exec("INSERT INTO fts(rowid, plain) VALUES(?, ?)", {
              bind: [rowid, block.plain],
            });
            blockIds.push(rowid);
          }
        }
        db.exec("COMMIT");
        post({ type: "upserted", docId: request.docId, blockIds });
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      break;
    }
    case "delete": {
      db.exec("DELETE FROM fts WHERE rowid IN (SELECT id FROM blocks WHERE doc_id = ?)", {
        bind: [request.docId],
      });
      db.exec("DELETE FROM blocks WHERE doc_id = ?", { bind: [request.docId] });
      db.exec("DELETE FROM pages WHERE doc_id = ?", { bind: [request.docId] });
      break;
    }
    case "query": {
      const escaped = request.text.replace(/["']/g, " ");
      const match = `"${escaped.trim().split(/\s+/).slice(0, 8).join('" "')}"`;
      const rows = db.selectArrays(
        `SELECT b.doc_id, b.block_index, b.kind, b.plain, b.range_start, b.range_end,
                bm25(fts) AS score, offsets(fts) AS offs
         FROM fts JOIN blocks b ON b.id = fts.rowid
         WHERE fts MATCH ?
         ORDER BY score LIMIT ?`,
        [match, request.limit],
      );
      const hitMap = new Map<string, SearchHit>();
      for (const row of rows) {
        const [docId, blockIndex, kind, plain, rangeStart, rangeEnd, score, offs] = row as [
          string,
          number,
          string,
          string,
          number,
          number,
          number,
          string,
        ];
        const existing = hitMap.get(docId);
        const offsets = parseOffsets(offs);
        const hit: SearchHit = {
          docId: String(docId),
          path: "",
          title: "",
          blockIndex: Number(blockIndex),
          kind: String(kind),
          plain: String(plain),
          rangeStart: Number(rangeStart),
          rangeEnd: Number(rangeEnd),
          offsets,
          bm25: Number(score),
        };
        if (!existing || existing.bm25 > hit.bm25) {
          const meta = db.selectArrays("SELECT path, title FROM pages WHERE doc_id = ?", [docId]);
          const m = meta[0];
          hit.path = String(m?.[0] ?? "");
          hit.title = String(m?.[1] ?? "");
          hitMap.set(docId, hit);
        }
      }

      // Keep the single best block per page, richer across pages.
      const hits = [...hitMap.values()].sort((a, b) => a.bm25 - b.bm25).slice(0, request.limit);
      post({ type: "query", hits });
      break;
    }
    case "semantic-query": {
      if (!vecReady) {
        post({ type: "semantic-query", hits: [] });
        break;
      }
      const vectorJson = JSON.stringify(request.vector);
      const rows = db.selectArrays(
        "SELECT rowid, distance FROM vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
        [vectorJson, request.limit],
      );
      const hits: SearchHit[] = [];
      for (const row of rows) {
        const [blockId, distance] = row as [number, number];
        const block = db.selectArrays(
          "SELECT b.doc_id, b.block_index, b.kind, b.plain, b.range_start, b.range_end, p.path, p.title " +
            "FROM blocks b JOIN pages p ON p.doc_id = b.doc_id WHERE b.id = ?",
          [blockId],
        );
        const m = block[0];
        if (!m) continue;
        hits.push({
          docId: String(m[0]),
          path: String(m[6]),
          title: String(m[7]),
          blockIndex: Number(m[1]),
          kind: String(m[2]),
          plain: String(m[3]),
          rangeStart: Number(m[4]),
          rangeEnd: Number(m[5]),
          offsets: [],
          bm25: 0,
          semantic: 1 - Number(distance),
        });
      }
      post({ type: "semantic-query", hits });
      break;
    }
    case "put-vector": {
      if (!vecReady) break;
      db.exec("DELETE FROM vec WHERE rowid = ?", { bind: [request.blockId] });
      db.exec("INSERT INTO vec(rowid, embedding) VALUES(?, ?)", {
        bind: [request.blockId, JSON.stringify(request.vector)],
      });
      break;
    }
    case "vectors-for": {
      if (!vecReady) {
        post({ type: "vectors", vectors: [] });
        break;
      }
      const rows = db.selectArrays(
        `SELECT b.id, v.embedding FROM blocks b JOIN vec v ON v.rowid = b.id WHERE b.doc_id = ?`,
        [request.docId],
      );
      const vectors = rows.map((row) => {
        const raw = String(row[1]);
        const vector = JSON.parse(raw) as number[];

        return { blockId: Number(row[0]), vector };
      });
      post({ type: "vectors", vectors });
      break;
    }
    case "wipe": {
      db.exec("DELETE FROM fts; DELETE FROM blocks; DELETE FROM pages; DELETE FROM vec;");
      break;
    }
    case "status": {
      post({ type: "status", status: status() });
      break;
    }
  }
}

function status(): IndexStatus {
  if (!db) return { mode, docs: 0, blocks: 0, vecReady };
  const pages = db.selectArrays("SELECT COUNT(*) FROM pages")[0]?.[0] ?? 0;
  const blocks = db.selectArrays("SELECT COUNT(*) FROM blocks")[0]?.[0] ?? 0;

  return { mode, docs: Number(pages), blocks: Number(blocks), vecReady };
}

function parseOffsets(offsets: string): Array<[number, number]> {
  // FTS5 offsets(): groups of "column term byteStart byteEnd".
  const parts = offsets.split(" ").filter(Boolean).map(Number);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 3 < parts.length; i += 4) {
    const start = parts[i + 2];
    const end = parts[i + 3];
    if (start !== undefined && end !== undefined) out.push([start, end]);
  }

  return out;
}

function packMap(map: number[]): Uint8Array {
  const buffer = new Uint8Array(new Uint32Array(map).buffer);

  return buffer;
}

function post(response: WorkerResponse): void {
  (self as unknown as Worker).postMessage(response);
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data).catch((error: unknown) => {
    post({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  });
});
