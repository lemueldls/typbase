<script setup lang="ts">
import type { BlobEntry, WorkspaceStore } from "@typbase/storage";
import type { MaterialSymbol } from "material-symbols";

import { blobReference, sniffMime } from "@typbase/storage";

const props = defineProps<{ store: WorkspaceStore }>();

const emit = defineEmits<{
  (e: "select", value: { hash: string; mime: string; reference: string }): void;
}>();

interface Asset extends BlobEntry {
  mime: string;
  url?: string;
}

/** Dialog state; the app bar opens it from the overflow menu or a trigger. */
const open = defineModel<boolean>("open", { default: false });
const assets = ref<Asset[]>([]);
const loading = ref(false);
const error = ref("");
const query = ref("");
const search = useTemplateRef("search");

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return assets.value;

  return assets.value.filter(
    (asset) => asset.mime.toLowerCase().includes(needle) || asset.hash.startsWith(needle),
  );
});

function revoke(): void {
  for (const asset of assets.value) {
    if (asset.url) URL.revokeObjectURL(asset.url);
  }
}

let refreshSeq = 0;

async function refresh(): Promise<void> {
  const store = props.store;
  if (!store) return;

  const seq = ++refreshSeq;
  loading.value = true;
  error.value = "";

  try {
    const entries = await store.listBlobs();
    const next: Asset[] = [];

    for (const entry of entries) {
      const bytes = await store.getBlob(entry.hash);
      if (!bytes) continue;

      const mime = sniffMime(bytes);
      next.push({
        ...entry,
        mime,
        url: mime.startsWith("image/")
          ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
          : undefined,
      });
    }

    // A newer refresh started while this one read the store; drop the stale
    // batch so its object URLs do not leak and old rows do not win.
    if (seq !== refreshSeq) {
      for (const asset of next) {
        if (asset.url) URL.revokeObjectURL(asset.url);
      }
      return;
    }

    revoke();
    assets.value = next;
  } catch (cause) {
    if (seq === refreshSeq) error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (seq === refreshSeq) loading.value = false;
  }
}

watch(open, (isOpen) => {
  if (isOpen) void refresh();
});
onBeforeUnmount(revoke);

function onOpenAutoFocus(event: Event): void {
  event.preventDefault();
  void nextTick(() => search.value?.focus());
}

function choose(asset: Asset): void {
  emit("select", {
    hash: asset.hash,
    mime: asset.mime,
    reference: blobReference(asset.hash, asset.mime),
  });
  open.value = false;
}

async function upload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const store = props.store;
  if (!file || !store) return;

  error.value = "";
  try {
    const entry = await store.putBlob(new Uint8Array(await file.arrayBuffer()));
    input.value = "";
    await refresh();

    // A fresh upload is what the user meant to pick; insert it straight away.
    const uploaded = assets.value.find((asset) => asset.hash === entry.hash);
    if (uploaded) choose(uploaded);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    class="asset-dialog"
    :title="$t('assets.title')"
    @open-auto-focus="onOpenAutoFocus"
  >
    <template v-if="$slots.default" #trigger>
      <slot />
    </template>

    <div class="picker">
      <div class="picker__toolbar">
        <UiTextField
          ref="search"
          v-model="query"
          class="picker__search"
          type="search"
          :placeholder="$t('assets.search')"
          :aria-label="$t('assets.search')"
        >
          <template #leading>
            <MsIcon name="search" :size="20" />
          </template>
        </UiTextField>
        <UiButton as="label" class="picker__upload">
          <MsIcon name="upload" :size="20" />
          {{ $t("assets.upload") }}
          <input type="file" hidden @change="upload" />
        </UiButton>
      </div>

      <p v-if="error" class="picker__error" role="alert">{{ error }}</p>
      <p v-else-if="loading" class="picker__hint">{{ $t("assets.loading") }}</p>
      <p v-else-if="!filtered.length" class="picker__hint">
        {{ assets.length ? $t("assets.noMatches") : $t("assets.empty") }}
      </p>

      <ul v-else class="picker__grid">
        <li v-for="asset in filtered" :key="asset.hash">
          <UiTooltip :text="asset.hash">
            <button type="button" class="picker__card" @click="choose(asset)">
              <span class="picker__thumb">
                <img v-if="asset.url" :src="asset.url" :alt="asset.mime" />
                <MsIcon v-else :name="iconFor(asset.mime)" :size="30" />
              </span>
              <span class="picker__meta">
                <span class="picker__ext">{{ extension(asset.mime) }}</span>
                <span>{{ formatSize(asset.size) }}</span>
              </span>
            </button>
          </UiTooltip>
        </li>
      </ul>

      <p v-if="filtered.length" class="picker__hint">{{ $t("assets.hint") }}</p>
    </div>
  </UiDialog>
</template>

<style>
/* Wider than the default dialog so the thumbnail grid breathes. */
.asset-dialog {
  width: min(680px, calc(100vw - var(--space-8)));
}

.picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2-5);
}

.picker__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.picker__search {
  flex: 1;
  min-width: 0;
}

.picker__upload {
  flex: none;
}

.picker__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
  gap: var(--space-2);
  max-height: min(50vh, 22rem);
  overflow-y: auto;
}

.picker__card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  width: 100%;
  padding: var(--space-1-5);
  font: inherit;
  color: var(--color-text);
  text-align: left;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.picker__card:hover,
.picker__card:focus-visible {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.picker__thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 4.2rem;
  overflow: hidden;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
}

.picker__thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.picker__meta {
  display: flex;
  justify-content: space-between;
  gap: var(--space-1-5);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.picker__ext {
  font-weight: 600;
  color: var(--color-text);
}

.picker__hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.picker__error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-danger);
}
</style>
