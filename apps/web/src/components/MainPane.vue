<script setup lang="ts">
import type { ViewModeId } from "~/lib/view";

defineProps<{
  pageId: string | null;
  pluginInstanceId?: string | null;
  chatThreadId?: string | null;
  graphOpen?: boolean;
  modelValue: ViewModeId;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", mode: ViewModeId): void;
  (e: "openPage", id: string): void;
  (e: "openPlugin", id: string): void;
  (e: "closePlugin"): void;
  (e: "openThread", id: string): void;
  (e: "closeChat"): void;
  (e: "closeGraph"): void;
}>();
</script>

<template>
  <ChatPane
    v-if="chatThreadId"
    :key="chatThreadId"
    :thread-id="chatThreadId"
    @close="emit('closeChat')"
    @open-page="emit('openPage', $event)"
    @open-thread="emit('openThread', $event)"
  >
    <template #nav-toggle>
      <slot name="nav-toggle" />
    </template>
  </ChatPane>

  <PluginView
    v-else-if="pluginInstanceId"
    :key="pluginInstanceId"
    :instance-id="pluginInstanceId"
    @close="emit('closePlugin')"
  >
    <template #nav-toggle>
      <slot name="nav-toggle" />
    </template>
  </PluginView>

  <GraphView
    v-else-if="graphOpen"
    :page-id="pageId"
    @open-page="emit('openPage', $event)"
    @close="emit('closeGraph')"
  >
    <template #nav-toggle>
      <slot name="nav-toggle" />
    </template>
  </GraphView>

  <PageView
    v-else-if="pageId"
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

<style>
.app__empty {
  flex: 1;
  display: grid;
  place-content: center;
  gap: var(--space-2);
  color: var(--color-text-secondary);
  text-align: center;
}

.app__empty-hint {
  margin: 0;
}
</style>
