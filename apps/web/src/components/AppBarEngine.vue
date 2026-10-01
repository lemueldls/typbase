<script setup lang="ts">
import { formatHeap, HEAP_WATERMARK, useEngineHealth } from "~/lib/engineHealth";
import { formatAgo } from "~/lib/format";

/**
 * The engine's health, with the wasm heap that usually explains it.
 *
 * The bar always carries the readout: a healthy engine shows a quiet heap size,
 * and a broken one shows the same number in the warning colour. Clicking opens a
 * panel with the rest, and the panel refreshes while it is open: the heap only
 * moves when something compiles, so polling a visible panel keeps the number
 * honest without a timer running behind a closed one.
 */
const { t, locale } = useI18n();
const engine = useEngineHealth();
const open = ref(false);
const heap = ref(0);

/** How often an open panel re-reads the heap. */
const HEAP_POLL_MS = 2000;

async function read(): Promise<void> {
  heap.value = await typstHeapBytes();
}

const { pause, resume } = useIntervalFn(() => void read(), HEAP_POLL_MS);

onMounted(() => void read());

watch(open, (value) => {
  if (!value) {
    pause();

    return;
  }

  void read();
  resume();
});

const broken = computed(() => engine.value.status !== "ok");

const statusLabel = computed(() => {
  switch (engine.value.status) {
    case "recovering":
      return t("nav.engineRecovering");
    case "failed":
      return t("nav.engineFailed");
    default:
      return t("nav.engineOk");
  }
});

const heapText = computed(() =>
  heap.value < 0 ? t("nav.engineHeapUnreadable") : formatHeap(heap.value),
);
</script>

<template>
  <UiPopover v-model:open="open" align="end" :side-offset="6" class="app-bar-engine">
    <template #trigger>
      <UiTooltip :text="statusLabel">
        <button
          type="button"
          class="app-bar-engine__trigger"
          :class="{ 'app-bar-engine__trigger--broken': broken }"
        >
          <MsIcon :name="broken ? 'warning' : 'memory'" :size="18" />
          <span class="app-bar-engine__heap">{{ heapText }}</span>
        </button>
      </UiTooltip>
    </template>

    <div class="app-bar-engine__panel">
      <p class="app-bar-engine__status" :class="{ 'app-bar-engine__status--broken': broken }">
        <MsIcon :name="broken ? 'warning' : 'check_circle'" :size="18" />
        <span>{{ statusLabel }}</span>
      </p>

      <dl class="app-bar-engine__facts">
        <dt>{{ $t("nav.engineHeap") }}</dt>
        <dd>{{ heapText }}</dd>
        <dt>{{ $t("nav.engineWatermark") }}</dt>
        <dd>{{ formatHeap(HEAP_WATERMARK) }}</dd>
        <dt>{{ $t("nav.engineFailures") }}</dt>
        <dd>{{ engine.consecutiveFailures }}</dd>
      </dl>

      <p v-if="engine.reason" class="app-bar-engine__reason">{{ engine.message }}</p>
      <p v-if="engine.lastFailureAt" class="app-bar-engine__when">
        {{ $t("nav.engineLastFailure", { ago: formatAgo(engine.lastFailureAt, locale) }) }}
      </p>
    </div>
  </UiPopover>
</template>

<style>
/* The popover surface, same shape as the graph's filter popover. UiPopover lands
   its class on the content and gives it no surface of its own. */
.app-bar-engine {
  z-index: 65;
  width: min(280px, calc(100vw - var(--space-4)));
  padding: var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 30px rgb(0 0 0 / 0.12);
  animation: ui-overlay-fade-in var(--motion-fast);
}

/* A quiet chip on its own, the warning colour only when the engine is not ok. */
.app-bar-engine__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: var(--control-sm);
  padding: 0 var(--space-2);
  font-family: inherit;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    color var(--motion-fast),
    background var(--motion-fast);
}

.app-bar-engine__trigger:hover {
  color: var(--color-text);
  background: var(--color-surface-2);
}

.app-bar-engine__trigger--broken {
  color: var(--color-warning);
}

.app-bar-engine__trigger--broken:hover {
  color: var(--color-warning);
}

.app-bar-engine__heap {
  font-variant-numeric: tabular-nums;
}

.app-bar-engine__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.app-bar-engine__status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.app-bar-engine__status--broken {
  color: var(--color-warning);
}

.app-bar-engine__facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-1) var(--space-2);
  margin: 0;
  font-size: var(--text-sm);
}

.app-bar-engine__facts dt {
  color: var(--color-text-secondary);
}

.app-bar-engine__facts dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.app-bar-engine__reason {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.app-bar-engine__when {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}
</style>
