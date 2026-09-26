<script setup lang="ts">
/**
 * Floating plugin windows. The host owns the frame, geometry, stacking, and
 * close button, so plugin authors never position fixed elements. Geometry
 * lives in device-local state (pluginWindows), not the synced plugin doc.
 */
import type { MaterialSymbol } from "material-symbols";

const plugins = usePlugins();
const { dataRevision } = useWorkspace();

const openWindows = computed(() => {
  void dataRevision.value;
  return plugins
    .instancesWithSurface("window")
    .filter((instance) => plugins.windowOf(instance.id).open);
});

function titleOf(instanceId: string): string {
  const instance = plugins.instanceById(instanceId);
  return instance ? (plugins.manifestOf(instance.pluginId)?.name ?? instance.title) : "";
}

function iconOf(instanceId: string): MaterialSymbol {
  const instance = plugins.instanceById(instanceId);
  const icon = instance?.icon || plugins.manifestOf(instance?.pluginId ?? "")?.icon;
  return (icon as MaterialSymbol | undefined) ?? "extension";
}

interface DragState {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  originWidth: number;
  originHeight: number;
}

const drag = ref<DragState | null>(null);

function startMove(event: PointerEvent, instanceId: string): void {
  if (event.button !== 0) return;
  const placement = plugins.windowOf(instanceId);
  drag.value = {
    id: instanceId,
    mode: "move",
    startX: event.clientX,
    startY: event.clientY,
    originX: placement.x,
    originY: placement.y,
    originWidth: placement.width,
    originHeight: placement.height,
  };
  plugins.focusWindow(instanceId);
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  event.preventDefault();
}

function startResize(event: PointerEvent, instanceId: string): void {
  if (event.button !== 0) return;
  const placement = plugins.windowOf(instanceId);
  drag.value = {
    id: instanceId,
    mode: "resize",
    startX: event.clientX,
    startY: event.clientY,
    originX: placement.x,
    originY: placement.y,
    originWidth: placement.width,
    originHeight: placement.height,
  };
  plugins.focusWindow(instanceId);
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}

function onPointerMove(event: PointerEvent): void {
  const active = drag.value;
  if (!active) return;

  const dx = event.clientX - active.startX;
  const dy = event.clientY - active.startY;
  if (active.mode === "move")
    plugins.moveWindow(active.id, active.originX + dx, active.originY + dy);
  else plugins.resizeWindow(active.id, active.originWidth + dx, active.originHeight + dy);
}

function endDrag(): void {
  drag.value = null;
}
</script>

<template>
  <div
    v-if="openWindows.length"
    class="plugin-windows"
    @pointermove="onPointerMove"
    @pointerup="endDrag"
    @pointercancel="endDrag"
  >
    <div
      v-for="instance in openWindows"
      :key="instance.id"
      class="plugin-window"
      :class="{ 'plugin-window--active': drag?.id === instance.id }"
      :style="{
        left: `${plugins.windowOf(instance.id).x}px`,
        top: `${plugins.windowOf(instance.id).y}px`,
        width: `${plugins.windowOf(instance.id).width}px`,
        height: `${plugins.windowOf(instance.id).height}px`,
        zIndex: 45 + plugins.windowOf(instance.id).z,
      }"
      @pointerdown="plugins.focusWindow(instance.id)"
    >
      <header class="plugin-window__header" @pointerdown="startMove($event, instance.id)">
        <MsIcon :name="iconOf(instance.id)" :size="16" />
        <UiTruncatedText class="plugin-window__title" :text="titleOf(instance.id)" />
        <UiIconButton
          icon="close"
          :label="$t('plugins.close')"
          @pointerdown.stop
          @click="plugins.closeWindow(instance.id)"
        />
      </header>

      <div class="plugin-window__body">
        <PluginSurface :instance-id="instance.id" surface="window" :title="titleOf(instance.id)" />
      </div>

      <div
        class="plugin-window__resize"
        :aria-label="$t('plugins.resize')"
        @pointerdown="startResize($event, instance.id)"
      />
    </div>
  </div>
</template>

<style>
.plugin-windows {
  position: fixed;
  inset: 0;
  z-index: 45;
  pointer-events: none;
}

.plugin-window {
  position: fixed;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.22);
  overflow: hidden;
}

.plugin-window__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--pane-header-height);
  padding: 0 var(--space-2) 0 var(--space-3);
  background: var(--color-surface-2);
  border-bottom: 1px solid var(--color-border);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.plugin-window--active .plugin-window__header {
  cursor: grabbing;
}

.plugin-window__title {
  flex: 1;
  min-width: 0;
  font-size: var(--text-md);
  font-weight: 600;
}

.plugin-window__body {
  flex: 1;
  min-height: 0;
  padding: var(--space-1-5);
}

.plugin-window__resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: var(--space-4);
  height: var(--space-4);
  cursor: nwse-resize;
  touch-action: none;
}
</style>
