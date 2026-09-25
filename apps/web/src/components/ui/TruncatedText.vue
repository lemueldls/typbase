<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** Full text; also the tooltip content. */
    text?: string;
    /** Tooltip placement. */
    side?: "top" | "right" | "bottom" | "left";
  }>(),
  { text: undefined, side: "top" },
);

const element = useTemplateRef("element");
const overflowing = ref(false);
const attrs = useAttrs();

function measure(): void {
  const node = element.value;
  if (!node) return;

  // +1 absorbs sub-pixel rounding at fractional zoom levels.
  overflowing.value = node.scrollWidth > node.clientWidth + 1;
}

useResizeObserver(element, measure);
watch(
  () => props.text,
  () => void nextTick(measure),
);
</script>

<template>
  <UiTooltip :text="text ?? ''" :side="side" :disabled="!overflowing">
    <span ref="element" v-bind="attrs" class="ui-truncated-text">
      <slot>{{ text }}</slot>
    </span>
  </UiTooltip>
</template>

<style>
.ui-truncated-text {
  display: inline-block;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
