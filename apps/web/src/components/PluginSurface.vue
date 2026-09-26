<script setup lang="ts">
import type { PluginSurfaceKind } from "@typbase/typing";

import type { PluginSurfaceState } from "~/composables/plugins";

import { attachPluginSurface, type PluginSurfaceHandle } from "~/lib/plugins/surface";

const props = withDefaults(
  defineProps<{
    instanceId: string;
    /** Which manifest surface to render for this instance. */
    surface: PluginSurfaceKind;
    title?: string;
    /** Widgets size to their content; panes and windows fill. */
    autoHeight?: boolean;
    minHeight?: number;
    maxHeight?: number;
  }>(),
  { minHeight: 72, maxHeight: 460, autoHeight: false },
);

const plugins = usePlugins();
const router = useRouter();
const host = useTemplateRef<HTMLDivElement>("host");
const height = ref(props.minHeight);
const state = shallowRef<PluginSurfaceState>();

let handle: PluginSurfaceHandle | undefined;
let unsubscribe: (() => void) | undefined;

function openStudio(): void {
  const instance = plugins.instanceById(props.instanceId);
  void router.push({
    path: "/plugins",
    query: instance ? { plugin: instance.pluginId } : undefined,
  });
}

onMounted(() => {
  const element = host.value;
  if (!element) return;

  handle = attachPluginSurface(element, {
    styles: state.value?.styles,
    components: plugins.hostComponentsOf(props.instanceId),
    onAction: (action) => void plugins.dispatch(props.instanceId, props.surface, action),
    onError: (message) => console.warn(`[plugins] ${message}`),
    onHeight: props.autoHeight
      ? (next) => {
          height.value = Math.max(props.minHeight, Math.min(props.maxHeight, next));
        }
      : undefined,
  });

  unsubscribe = plugins.subscribe(props.instanceId, props.surface, (next) => {
    state.value = next;
    if (next.status === "ok") handle?.render(next.html, next.styles);
  });
});

onBeforeUnmount(() => {
  unsubscribe?.();
  handle?.destroy();
});
</script>

<template>
  <div
    class="plugin-surface-wrap"
    :class="{ 'plugin-surface-wrap--auto': autoHeight }"
    :style="autoHeight ? { minHeight: `${minHeight}px`, maxHeight: `${maxHeight}px` } : undefined"
  >
    <div v-if="state?.status === 'error'" class="plugin-surface__error">
      <p class="plugin-surface__error-text">
        {{ state.error || $t("plugins.renderFailed") }}
      </p>
      <UiButton size="small" variant="ghost" @click="openStudio">
        {{ $t("plugins.develop") }}
      </UiButton>
    </div>
    <div
      v-show="state?.status !== 'error'"
      ref="host"
      class="plugin-surface"
      :class="{ 'plugin-surface--auto': autoHeight }"
      :style="autoHeight ? { height: `${height}px` } : undefined"
      :title="title"
    />
  </div>
</template>

<style>
.plugin-surface-wrap {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.plugin-surface-wrap--auto {
  height: auto;
}

.plugin-surface {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.plugin-surface-wrap--auto .plugin-surface {
  min-height: 4rem;
  height: auto;
}

.plugin-surface__error {
  display: grid;
  justify-items: start;
  gap: var(--space-2);
  padding: var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-radius: var(--radius-md);
}

.plugin-surface__error-text {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
