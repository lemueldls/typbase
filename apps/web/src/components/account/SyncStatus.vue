<script setup lang="ts">
import { formatAgo } from "~/lib/format";

withDefaults(defineProps<{ plain?: boolean }>(), { plain: false });

const { atprotoStatus } = useWorkspace();
const { t, locale } = useI18n();

const exporting = computed(
  () => atprotoStatus.value.pendingUpdates > 0 || atprotoStatus.value.assets.pending > 0,
);

const tone = computed(() => {
  if (atprotoStatus.value.error) return "error";
  if (!atprotoStatus.value.syncing) return "off";
  if (exporting.value) return "busy";

  return "ok";
});

const label = computed(() => {
  if (atprotoStatus.value.error) return atprotoStatus.value.error;
  if (!atprotoStatus.value.syncing) return t("settings.syncOff");
  if (exporting.value) return t("settings.syncExporting");

  return t("settings.syncInSync");
});

function ago(timestamp: number): string {
  return timestamp ? formatAgo(timestamp, locale.value) : t("settings.syncNever");
}
</script>

<template>
  <div
    class="sync-status"
    :class="[`sync-status--${tone}`, { 'sync-status--plain': plain }]"
    role="status"
    aria-live="polite"
  >
    <div class="sync-status__head">
      <span class="sync-status__dot" aria-hidden="true" />
      <span class="sync-status__label">{{ label }}</span>
      <UiBadge
        v-if="atprotoStatus.pendingUpdates"
        tone="warning"
        size="default"
        class="sync-status__count"
      >
        {{ t("settings.syncPendingCount", { count: atprotoStatus.pendingUpdates }) }}
      </UiBadge>
    </div>

    <div v-if="atprotoStatus.syncing" class="sync-status__meta">
      <span class="sync-status__meta-item">
        <MsIcon name="upload" :size="14" />
        {{ t("settings.syncExported") }} {{ ago(atprotoStatus.lastExportAt) }}
      </span>
      <span class="sync-status__meta-item">
        <MsIcon name="download" :size="14" />
        {{ t("settings.syncImported") }} {{ ago(atprotoStatus.lastImportAt) }}
      </span>
      <span v-if="atprotoStatus.assets.pending" class="sync-status__meta-item">
        <MsIcon name="photo_library" :size="14" />
        {{ t("settings.syncAssetsPending", { count: atprotoStatus.assets.pending }) }}
      </span>
      <span v-else-if="atprotoStatus.assets.lastSyncedAt" class="sync-status__meta-item">
        <MsIcon name="photo_library" :size="14" />
        {{ t("settings.syncAssetsSynced", { time: ago(atprotoStatus.assets.lastSyncedAt) }) }}
      </span>
    </div>

    <p v-if="atprotoStatus.assets.error" class="sync-status__error" role="alert">
      {{ atprotoStatus.assets.error }}
    </p>
  </div>
</template>

<style>
.sync-status {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  padding: var(--space-2) var(--space-2-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.sync-status--plain {
  padding: 0;
  background: transparent;
  border: 0;
}

.sync-status__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.sync-status__dot {
  flex: none;
  width: 8px;
  height: 8px;
  background: var(--color-ok);
  border-radius: 50%;
  box-shadow: 0 0 0 3px var(--color-ok-soft);
}

.sync-status--busy .sync-status__dot {
  background: var(--color-warning);
  box-shadow: 0 0 0 3px var(--color-warning-soft);
}

.sync-status--error .sync-status__dot {
  background: var(--color-danger);
  box-shadow: 0 0 0 3px var(--color-danger-soft);
}

.sync-status--off .sync-status__dot {
  background: var(--color-text-tertiary);
  box-shadow: none;
}

.sync-status__label {
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.sync-status__count {
  margin-left: auto;
}

.sync-status__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
}

.sync-status__meta-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-0-5);
}

.sync-status__error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-danger);
  overflow-wrap: anywhere;
}
</style>
