<script setup lang="ts">
import type { ViewModeId } from "~/lib/view";

defineProps<{
  pageId: string | null;
  pluginInstanceId?: string | null;
  chatThreadId?: string | null;
  graphOpen?: boolean;
  /** Desktop side dock: a thread shown beside the main pane. */
  dockChatId?: string | null;
  modelValue: ViewModeId;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", mode: ViewModeId): void;
  (e: "openPage", id: string): void;
  (e: "openPlugin", id: string): void;
  (e: "closePlugin"): void;
  (e: "openThread", id: string): void;
  (e: "closeChat"): void;
  (e: "closeDock"): void;
  (e: "expandDock"): void;
  (e: "openGraph"): void;
  (e: "closeGraph"): void;
}>();

/** Dock width in px; persisted like the sidebar's layout. */
const dockWidth = useLocalStorage("typbase:dockWidth", 380);

function clampDock(width: number): number {
  return Math.min(620, Math.max(280, width));
}

/** The dock handle is a plain pointer drag, like the editor's split handle. */
function startDockDrag(event: PointerEvent): void {
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startWidth = dockWidth.value;
  target.setPointerCapture(event.pointerId);

  const onMove = (move: PointerEvent) => {
    dockWidth.value = clampDock(startWidth - (move.clientX - startX));
  };

  const onUp = () => {
    target.releasePointerCapture(event.pointerId);
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", onUp);
  };

  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
}

function onDockKeydown(event: KeyboardEvent): void {
  const step = event.key === "ArrowLeft" ? 24 : event.key === "ArrowRight" ? -24 : 0;
  if (!step) return;

  event.preventDefault();
  dockWidth.value = clampDock(dockWidth.value + step);
}
</script>

<template>
  <div class="main-pane">
    <div class="main-pane__primary">
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
        @open-graph="emit('openGraph')"
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
    </div>

    <template v-if="dockChatId">
      <div
        class="app__resize-handle main-pane__handle"
        role="separator"
        aria-orientation="vertical"
        tabindex="0"
        :aria-label="$t('chat.resizeDock')"
        @pointerdown="startDockDrag"
        @keydown="onDockKeydown"
      />

      <ChatPane
        :key="dockChatId"
        class="main-pane__dock"
        :style="{ width: `${dockWidth}px` }"
        :thread-id="dockChatId"
        docked
        @close="emit('closeDock')"
        @expand="emit('expandDock')"
        @open-page="emit('openPage', $event)"
        @open-thread="emit('openThread', $event)"
      />
    </template>
  </div>
</template>

<style>
.main-pane {
  display: flex;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.main-pane__primary {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.main-pane__primary > * {
  flex: 1;
  min-height: 0;
}

.main-pane__dock {
  flex: 0 0 auto;
  min-width: 0;
  max-width: 60%;
  border-left: 1px solid var(--color-border);
}

.main-pane__handle {
  height: 100%;
}

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
