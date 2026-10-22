<script setup lang="ts">
const emit = defineEmits<{ (e: "close"): void }>();
</script>

<template>
  <div class="files-view">
    <div class="files-view__toolbar" data-tauri-drag-region="deep">
      <slot name="nav-toggle" />
      <MsIcon name="folder_open" :size="20" />
      <span class="files-view__title">{{ $t("explorer.title") }}</span>
      <div class="files-view__actions">
        <UiIconButton icon="close" :label="$t('common.close')" @click="emit('close')" />
      </div>
    </div>

    <div class="files-view__body">
      <StorageExplorer initial-view="files" />
    </div>
  </div>
</template>

<style>
.files-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.files-view__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--pane-header-height);
  padding: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.files-view__title {
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-lg);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files-view__actions {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
}

.files-view__body {
  flex: 1;
  min-height: 0;
  padding: var(--space-3);
  overflow-y: auto;
  background: var(--color-surface-2);
}

.files-view__body .explorer {
  max-width: 64rem;
  margin: 0 auto;
}
</style>
