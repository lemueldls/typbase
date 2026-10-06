<script setup lang="ts">
import type { PageMeta } from "@typbase/typing";

import type { ViewModeId } from "~/lib/view";

import { todayISO } from "~/lib/format";

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

/** The empty pane's actions need the workspace the chooser left behind. */
const { workspace: store } = useWorkspace();

function onCreated(page: PageMeta): void {
  emit("openPage", page.id);
}

/** Creates today's daily note when it is missing, then opens it. */
async function openToday(): Promise<void> {
  if (!store.value) return;

  const page = await store.value.createDailyNote(todayISO());
  emit("openPage", page.id);
}

/** Dock width in px, persisted like the sidebar's layout. */
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
        @open-plugin="emit('openPlugin', $event)"
        @open-graph="emit('openGraph')"
      >
        <template #nav-toggle>
          <slot name="nav-toggle" />
        </template>
      </PageView>

      <div v-else class="app__empty">
        <slot name="nav-toggle" />

        <!-- Only reachable with no pages at all, since a workspace that has any
             always resolves to one. The actions live here rather than pointing
             at the sidebar, which is collapsed on desktop and a drawer on
             mobile. -->
        <div v-if="store" class="app__empty-panel">
          <MsIcon name="note_stack" :size="44" class="app__empty-mark" />
          <p class="app__empty-title">{{ $t("empty.title") }}</p>
          <p class="app__empty-hint">{{ $t("empty.body") }}</p>

          <div class="app__empty-actions">
            <NewPageDialog :store="store" @created="onCreated">
              <UiButton variant="primary" icon="note_add">{{ $t("sidebar.newPage") }}</UiButton>
            </NewPageDialog>
            <UiButton variant="plain" icon="calendar_today" @click="openToday">
              {{ $t("empty.today") }}
            </UiButton>
          </div>
        </div>
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
  justify-items: center;
  padding: var(--space-6);
  color: var(--color-text-secondary);
  text-align: center;
}

/* The sidebar toggle is a window control, not part of the centered block: taking
   it out of flow keeps the panel on the pane's middle. */
.app__empty .app__nav-toggle {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
}

.app__empty-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  max-width: 28rem;
}

.app__empty-mark {
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.app__empty-title {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--color-text);
}

.app__empty-hint {
  margin: 0;
}

.app__empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
</style>
