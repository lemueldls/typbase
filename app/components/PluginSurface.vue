<script setup lang="ts">
import { attachPluginSurface, type PluginSurfaceHandle } from "~/lib/plugins/surface";

/**
 * One plugin surface, rendered into a shadow root. The host compiles and
 * sanitizes the HTML; this component wires the runtime and reports sizes.
 */
const props = withDefaults(
  defineProps<{
    instanceId: string;
    title?: string;
    /** Sidebar widgets size to their content; panes and overlays fill. */
    autoHeight?: boolean;
    minHeight?: number;
    maxHeight?: number;
    /** Overlay surfaces let pointer events fall through to the app. */
    passThrough?: boolean;
  }>(),
  { minHeight: 72, maxHeight: 460, autoHeight: false, passThrough: false },
);

const plugins = usePlugins();
const host = useTemplateRef<HTMLDivElement>("host");
const height = ref(props.minHeight);

let surface: PluginSurfaceHandle | undefined;
let unsubscribe: (() => void) | undefined;

onMounted(() => {
  const element = host.value;
  if (!element) return;

  surface = attachPluginSurface(element, {
    passThrough: props.passThrough,
    onAction: (action) => void plugins.dispatch(props.instanceId, action),
    onError: (message) => console.warn(`[plugins] ${message}`),
    onHeight: props.autoHeight
      ? (next) => {
          height.value = Math.max(props.minHeight, Math.min(props.maxHeight, next));
        }
      : undefined,
  });

  unsubscribe = plugins.subscribe(props.instanceId, (html) => surface?.render(html));
});

onBeforeUnmount(() => {
  unsubscribe?.();
  surface?.destroy();
});
</script>

<template>
  <div
    ref="host"
    class="plugin-surface"
    :class="{ 'plugin-surface--auto': autoHeight, 'plugin-surface--fill': passThrough }"
    :style="autoHeight ? { height: `${height}px` } : undefined"
    :title="title"
  />
</template>

<style scoped>
.plugin-surface {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.plugin-surface--auto {
  min-height: 4rem;
}

.plugin-surface--fill {
  position: fixed;
  inset: 0;
  width: auto;
  height: auto;
  pointer-events: none;
}
</style>
