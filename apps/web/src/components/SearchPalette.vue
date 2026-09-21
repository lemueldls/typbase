<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

defineProps<{
  store: WorkspaceStore;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "open", payload: { pageId: string; from?: number; to?: number }): void;
}>();

/** Touch devices get a drawer they can swipe or tap away; desktop gets the box. */
const isTouch = useMediaQuery("(hover: none) and (pointer: coarse)");

/** The drawer is always mounted open; any close reason surfaces as one event. */
function onDrawerOpen(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <DrawerRoot v-if="isTouch" :open="true" @update:open="onDrawerOpen">
    <DrawerPortal>
      <DrawerOverlay class="search-palette__backdrop" />
      <DrawerContent class="search-palette__sheet">
        <VisuallyHidden as-child>
          <DrawerTitle>{{ $t("palette.label") }}</DrawerTitle>
        </VisuallyHidden>
        <VisuallyHidden as-child>
          <DrawerDescription>{{ $t("palette.prompt") }}</DrawerDescription>
        </VisuallyHidden>
        <DrawerHandle class="search-palette__handle" />
        <SearchPalettePanel :store="store" @close="emit('close')" @open="emit('open', $event)" />
      </DrawerContent>
    </DrawerPortal>
  </DrawerRoot>

  <div v-else class="search-palette" @click.self="emit('close')">
    <div class="search-palette__box">
      <SearchPalettePanel :store="store" @close="emit('close')" @open="emit('open', $event)" />
    </div>
  </div>
</template>

<style scoped>
.search-palette {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10dvh;
  background: var(--color-overlay);
  animation: search-palette-fade 120ms ease-out;
}

.search-palette__box {
  display: flex;
  flex-direction: column;
  width: min(560px, calc(100vw - var(--space-8)));
  /* One height, so results do not resize the box under the pointer. */
  height: min(62dvh, 520px);
  /* The input and footer stay put; only the results scroll. */
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 24px 70px rgb(0 0 0 / 0.3);
  padding: var(--space-2);
  animation: search-palette-rise 140ms ease-out;
}

@keyframes search-palette-fade {
  from {
    opacity: 0;
  }
}

@keyframes search-palette-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

.search-palette__backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: var(--color-overlay);
  animation: search-palette-fade 150ms ease-out;
}

.search-palette__sheet {
  /* Extra room past the bottom edge so an upward drag shows the sheet, not the
     page; the negative margin parks it below the viewport. */
  --bleed: 40px;
  position: fixed;
  inset-inline: 0;
  bottom: 0;
  z-index: 91;
  display: flex;
  flex-direction: column;
  /* Same reasoning as the desktop box: a stable height beats resizing under
     the thumb as results stream in. */
  height: 88dvh;
  overflow: hidden;
  padding: var(--space-1) var(--space-2)
    calc(env(safe-area-inset-bottom, 0px) + var(--space-2) + var(--bleed));
  margin-bottom: calc(-1 * var(--bleed));
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-bottom: 0;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  box-shadow: 0 -18px 50px rgb(0 0 0 / 0.3);
  transform: translateY(var(--drawer-swipe-movement-y, 0px));
  transition: transform 300ms cubic-bezier(0.32, 0.72, 0, 1);
  animation: search-palette-sheet-in 280ms cubic-bezier(0.32, 0.72, 0, 1) both;
}

.search-palette__sheet[data-swiping] {
  transition-duration: 0ms;
}

@keyframes search-palette-sheet-in {
  from {
    translate: 0 100%;
  }
}

.search-palette__handle {
  flex: none;
  width: 40px;
  height: 4px;
  margin: 0 auto var(--space-1-5);
  border-radius: 2px;
  background: var(--color-border-strong);
}
</style>
