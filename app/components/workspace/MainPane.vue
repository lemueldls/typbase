<script setup lang="ts">
import type { ViewMode } from "./PageView.vue";

import PageView from "./PageView.vue";

defineProps<{
  pageId: string | null;
  modelValue: ViewMode;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", mode: ViewMode): void;
  (e: "openPage", id: string): void;
}>();
</script>

<template>
  <PageView
    v-if="pageId"
    :key="pageId"
    :page-id="pageId"
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    @open-page="emit('openPage', $event)"
  >
    <template #nav-toggle>
      <slot name="nav-toggle" />
    </template>
  </PageView>

  <div v-else class="app__empty">
    <slot name="nav-toggle" />
    <p>{{ $t("sidebar.noPages") }}</p>
    <p class="app__empty-hint">{{ $t("boot.createOne") }}</p>
  </div>
</template>

<style scoped>
.app__empty {
  flex: 1;
  display: grid;
  place-content: center;
  gap: 0.5rem;
  color: var(--text-secondary);
  text-align: center;
}

.app__empty-hint {
  margin: 0;
}
</style>
