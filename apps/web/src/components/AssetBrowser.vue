<script setup lang="ts">
import type { BlobEntry } from "@typbase/storage";
import type { MaterialSymbol } from "material-symbols";

import { blobReference, sniffMime } from "@typbase/storage";

/**
 * Media stored in the workspace's local blob tree. OPFS and Tauri app-data
 * roots have no file manager, so this is the only place to see what is
 * actually on disk: previews, sizes, references, upload and cleanup.
 */
interface AssetRow extends BlobEntry {
  mime: string;
  url?: string;
  pageTitles: string[];
}

const { workspace } = useWorkspace();
const { t } = useI18n();

const rows = ref<AssetRow[]>([]);
const loading = ref(false);
const error = ref("");
const status = ref("");

function revokeUrls(): void {
  for (const row of rows.value) {
    if (row.url) URL.revokeObjectURL(row.url);
  }
}

async function refresh(): Promise<void> {
  const store = workspace.value;
  if (!store) {
    rows.value = [];
    return;
  }

  loading.value = true;
  error.value = "";
  status.value = "";

  try {
    const entries = await store.listBlobs();
    const references = await store.findBlobReferences();
    const next: AssetRow[] = [];

    for (const entry of entries) {
      const bytes = await store.getBlob(entry.hash);
      if (!bytes) continue;

      const mime = sniffMime(bytes);
      const url = mime.startsWith("image/")
        ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
        : undefined;
      const pages = references.get(entry.hash) ?? [];

      next.push({
        ...entry,
        mime,
        url,
        pageTitles: pages.map((id) => store.getPage(id)?.title ?? id),
      });
    }

    revokeUrls();
    rows.value = next;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

onMounted(() => void refresh());
onBeforeUnmount(revokeUrls);
defineExpose({ refresh });

function iconFor(mime: string): MaterialSymbol {
  if (mime === "application/pdf") return "picture_as_pdf";
  if (mime.startsWith("video/")) return "movie";
  if (mime.startsWith("audio/")) return "music_note";
  if (mime.startsWith("font/")) return "text_fields";

  return "draft";
}

function extension(mime: string): string {
  return mime.split("/")[1]?.split("+")[0]?.toUpperCase() ?? "FILE";
}

/** Rows can be dragged into an editor; the editor reads this payload. */
function onDragStart(event: DragEvent, row: AssetRow): void {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(
    "application/x-typbase-asset",
    JSON.stringify({ hash: row.hash, mime: row.mime }),
  );
  event.dataTransfer.setData("text/plain", blobReference(row.hash, row.mime));
  event.dataTransfer.effectAllowed = "copy";
}

async function upload(event: Event): Promise<void> {
  const store = workspace.value;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!store || !file) return;

  error.value = "";
  try {
    await store.putBlob(new Uint8Array(await file.arrayBuffer()));
    input.value = "";
    await refresh();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function copyReference(row: AssetRow): Promise<void> {
  const reference = blobReference(row.hash, row.mime);
  const text = row.mime.startsWith("image/") ? `#image("${reference}")` : reference;

  try {
    await navigator.clipboard.writeText(text);
    status.value = t("explorer.assetCopied");
  } catch {
    // Clipboard can be blocked; show the text so it can be copied by hand.
    status.value = text;
  }
}

async function download(row: AssetRow): Promise<void> {
  const store = workspace.value;
  if (!store) return;

  const bytes = await store.getBlob(row.hash);
  if (!bytes) return;

  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: row.mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${row.hash.slice(0, 12)}.${row.mime.split("/")[1] ?? "bin"}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function remove(row: AssetRow): Promise<void> {
  const store = workspace.value;
  if (!store) return;
  if (!window.confirm(t("explorer.assetDeleteConfirm", { hash: row.hash.slice(0, 12) }))) return;

  try {
    await store.deleteBlob(row.hash);
    await refresh();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function pruneUnused(): Promise<void> {
  const store = workspace.value;
  if (!store) return;
  if (!window.confirm(t("explorer.assetPruneConfirm"))) return;

  const unused = rows.value.filter((row) => row.pageTitles.length === 0);
  try {
    for (const row of unused) await store.deleteBlob(row.hash);
    await refresh();
    status.value = t("explorer.assetPruned", { count: unused.length });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}
</script>

<template>
  <div class="assets">
    <div class="assets__toolbar">
      <Label class="button button--tiny">
        {{ $t("explorer.assetUpload") }}
        <input type="file" hidden @change="upload" />
      </Label>
      <button type="button" class="button button--tiny" @click="pruneUnused">
        {{ $t("explorer.assetPrune") }}
      </button>
      <span class="assets__status">{{ status }}</span>
    </div>

    <p v-if="error" class="assets__error" role="alert">{{ error }}</p>
    <p v-if="!rows.length && !loading" class="assets__empty">
      {{ $t("explorer.assetEmpty") }}
    </p>

    <ul class="assets__list">
      <UiTooltip v-for="row in rows" :key="row.hash" :text="$t('explorer.assetDrag')">
        <li class="assets__row" draggable="true" @dragstart="onDragStart($event, row)">
          <div class="assets__preview">
            <img v-if="row.url" :src="row.url" :alt="row.hash" />
            <MsIcon v-else :name="iconFor(row.mime)" :size="28" />
          </div>

          <div class="assets__meta">
            <span class="assets__name">{{ row.mime }} · {{ extension(row.mime) }}</span>
            <span class="assets__hash">{{ row.hash.slice(0, 16) }}…</span>
            <span class="assets__refs">
              {{
                row.pageTitles.length
                  ? $t("explorer.assetReferences", { count: row.pageTitles.length })
                  : $t("explorer.assetUnused")
              }}
              <template v-if="row.pageTitles.length">
                · {{ row.pageTitles.slice(0, 3).join(", ") }}
              </template>
            </span>
          </div>

          <span class="assets__actions">
            <UiIconButton
              icon="content_copy"
              :size="16"
              :label="$t('explorer.assetCopy')"
              variant="ghost"
              class="button--tiny"
              @click="copyReference(row)"
            />
            <UiIconButton
              icon="download"
              :size="16"
              :label="$t('explorer.assetDownload')"
              variant="ghost"
              class="button--tiny"
              @click="download(row)"
            />
            <UiIconButton
              icon="delete"
              :size="16"
              :label="$t('explorer.assetDelete')"
              variant="ghost"
              danger
              class="button--tiny"
              @click="remove(row)"
            />
          </span>
        </li>
      </UiTooltip>
    </ul>
  </div>
</template>

<style scoped>
.assets {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.assets__toolbar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.assets__status {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assets__error {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-danger);
}

.assets__empty {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.assets__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.assets__row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--color-border);
  cursor: grab;
}

.assets__row:active {
  cursor: grabbing;
}

.assets__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 2.6rem;
  flex: none;
  overflow: hidden;
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border-radius: 0.35rem;
}

.assets__preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.assets__meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.assets__name {
  font-size: 0.85rem;
}

.assets__hash {
  font-family: var(--font-mono, monospace);
  font-size: 0.72rem;
  color: var(--color-text-secondary);
}

.assets__refs {
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assets__actions {
  display: flex;
  gap: 0.1rem;
  flex: none;
}
</style>
