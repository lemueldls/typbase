import type { StorageBackend } from "./backend";

/**
 * Never-synced device state, one JSON file per workspace: OAuth identity
 * mirror, per-member repo cursors, sync queue, AI keys, publish tokens.
 * Nothing here ever enters a Loro doc or a space record.
 */
export class LocalState {
  private data: Record<string, unknown> = {};
  private loaded = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly backend: StorageBackend,
    private readonly path: string,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;

    const bytes = await this.backend.read(this.path);
    if (bytes) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          this.data = parsed as Record<string, unknown>;
        }
      } catch {
        // Corrupt local.json: start fresh rather than losing the app.
      }
    }
    this.loaded = true;
  }

  async get<T>(key: string): Promise<T | undefined> {
    await this.load();

    return this.data[key] as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.load();
    this.data[key] = value;
    this.scheduleWrite();
  }

  /** Writes any pending changes. Call on pagehide like the snapshot flush. */
  async flush(): Promise<void> {
    if (!this.loaded) return;

    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.backend.write(this.path, new TextEncoder().encode(JSON.stringify(this.data)));
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 500);
  }
}

export function localStatePath(workspaceId: string): string {
  return `workspaces/${workspaceId}/state/local.json`;
}
