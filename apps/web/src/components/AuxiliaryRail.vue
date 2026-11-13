<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

export type AuxiliaryPanel = "chat" | "links";

const props = defineProps<{
  side: "left" | "right";
  panels: AuxiliaryPanel[];
  active: AuxiliaryPanel;
  chatId: string | null;
  pageId: string | null;
  store: WorkspaceStore;
  /** Render as an overlay drawer instead of an inline splitter panel. */
  floating?: boolean;
}>();

const emit = defineEmits<{
  (e: "closePanel", panel: AuxiliaryPanel): void;
  (e: "expandChat"): void;
  (e: "openThread", id: string): void;
  (e: "openPage", id: string): void;
  (e: "openGraph"): void;
  (e: "move", side: "left" | "right"): void;
  (e: "update:active", panel: AuxiliaryPanel): void;
  (e: "close"): void;
}>();

const { t } = useI18n();

const showTabs = computed(() => props.panels.length > 1);

const moveLabel = computed(() => (props.side === "left" ? t("aux.moveRight") : t("aux.moveLeft")));

function labelFor(panel: AuxiliaryPanel): string {
  return panel === "chat" ? t("aux.chat") : t("aux.links");
}

function iconFor(panel: AuxiliaryPanel): "forum" | "link" {
  return panel === "chat" ? "forum" : "link";
}

function onMove(): void {
  emit("move", props.side === "left" ? "right" : "left");
}

let drag: { pointerId: number; startX: number } | null = null;

function startDrag(event: PointerEvent): void {
  if (event.pointerType !== "mouse" || event.button !== 0) return;

  drag = { pointerId: event.pointerId, startX: event.clientX };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  event.preventDefault();
}

function endDrag(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return;

  const moved = event.clientX - drag.startX;
  drag = null;
  if (Math.abs(moved) < 24) return;

  const target = event.clientX < window.innerWidth / 2 ? "left" : "right";
  if (target !== props.side) emit("move", target);
}
</script>

<template>
  <button
    v-if="floating"
    type="button"
    class="aux-rail__backdrop"
    :aria-label="$t('common.close')"
    @click="emit('close')"
  />
  <aside
    class="aux-rail"
    :class="[`aux-rail--${side}`, { 'aux-rail--floating': floating, 'aux-rail--tabs': showTabs }]"
    :aria-label="$t('aux.title')"
  >
    <div
      v-if="!floating"
      class="aux-rail__grip"
      role="separator"
      aria-orientation="vertical"
      :aria-label="moveLabel"
      tabindex="0"
      @pointerdown="startDrag"
      @pointerup="endDrag"
      @pointercancel="drag = null"
      @keydown.left.prevent="side === 'right' && emit('move', 'left')"
      @keydown.right.prevent="side === 'left' && emit('move', 'right')"
    />

    <div v-if="showTabs" class="aux-rail__tabs">
      <button
        v-for="panel in panels"
        :key="panel"
        type="button"
        class="aux-rail__tab"
        :class="{ 'aux-rail__tab--active': active === panel }"
        :aria-pressed="active === panel"
        @click="emit('update:active', panel)"
      >
        <MsIcon :name="iconFor(panel)" :size="16" />
        <span>{{ labelFor(panel) }}</span>
      </button>
      <UiIconButton
        icon="swap_horiz"
        :label="moveLabel"
        variant="ghost"
        class="aux-rail__move"
        @click="onMove"
      />
      <UiIconButton
        icon="close"
        :label="$t('common.close')"
        variant="ghost"
        @click="floating ? emit('close') : emit('closePanel', active)"
      />
    </div>

    <div v-if="active === 'chat' && chatId" class="aux-rail__body">
      <ChatPane
        :key="chatId"
        :thread-id="chatId"
        docked
        @close="emit('closePanel', 'chat')"
        @expand="emit('expandChat')"
        @open-page="emit('openPage', $event)"
        @open-thread="emit('openThread', $event)"
      >
        <template v-if="!showTabs" #rail-actions>
          <UiIconButton icon="swap_horiz" :label="moveLabel" variant="ghost" @click="onMove" />
        </template>
      </ChatPane>
    </div>

    <div v-else-if="active === 'links' && pageId" class="aux-rail__body">
      <LinksPanel
        :page-id="pageId"
        :store="store"
        rail
        @close="emit('closePanel', 'links')"
        @open-page="emit('openPage', $event)"
        @open-graph="emit('openGraph')"
      >
        <template v-if="!showTabs" #rail-actions>
          <UiIconButton icon="swap_horiz" :label="moveLabel" variant="ghost" @click="onMove" />
        </template>
      </LinksPanel>
    </div>
  </aside>
</template>

<style>
.aux-rail {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-surface);
}

.aux-rail--floating {
  position: fixed;
  top: 0;
  bottom: 0;
  z-index: var(--z-drawer);
  width: min(92vw, 380px);
  padding-top: var(--safe-top);
  padding-bottom: var(--safe-bottom);
  border: var(--island-border);
  box-shadow: var(--shadow-3);
  overflow: hidden;
}

.aux-rail--floating.aux-rail--left {
  left: 0;
  border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
}

.aux-rail--floating.aux-rail--right {
  right: 0;
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
}

.aux-rail__backdrop {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-drawer) - 1);
  padding: 0;
  background: var(--color-overlay);
  border: 0;
}

.aux-rail__grip {
  position: absolute;
  top: 0;
  left: 50%;
  z-index: 3;
  width: 44px;
  height: 12px;
  transform: translateX(-50%);
  cursor: grab;
  touch-action: none;
}

.aux-rail__grip::before {
  content: "";
  position: absolute;
  top: 4px;
  left: 50%;
  width: 24px;
  height: 2px;
  transform: translateX(-50%);
  background: var(--color-border-strong);
  border-radius: var(--radius-full);
  opacity: 0;
  transition: opacity var(--motion-fast);
}

.aux-rail__grip:hover::before,
.aux-rail__grip:focus-visible::before {
  opacity: 1;
}

.aux-rail__tabs {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
  min-height: var(--control-md);
  padding: var(--space-1) var(--space-2);
  background: var(--color-surface-2);
}

.aux-rail__tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  height: var(--control-sm);
  padding: 0 var(--space-2);
  font-family: inherit;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.aux-rail__tab:hover {
  color: var(--color-text);
  background: var(--color-surface-3);
}

.aux-rail__tab--active {
  color: var(--color-text);
  background: var(--color-surface);
  box-shadow: var(--shadow-1);
}

.aux-rail__move {
  margin-left: auto;
}

.aux-rail__body {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.aux-rail__body > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
</style>
