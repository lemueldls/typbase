<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    /** Current value; drives the indicator width. */
    value: number;
    max?: number;
  }>(),
  { max: 100 },
);

const percent = computed(() => Math.min(100, Math.max(0, (props.value / props.max) * 100)));
</script>

<template>
  <ProgressRoot class="ui-progress" :model-value="value" :max="max">
    <ProgressIndicator class="ui-progress__indicator" :style="{ width: `${percent}%` }" />
  </ProgressRoot>
</template>

<style scoped>
.ui-progress {
  display: block;
  height: 2px;
  overflow: hidden;
  background: var(--color-border);
  border-radius: 2px;
}

.ui-progress__indicator {
  height: 100%;
  background: var(--color-accent);
  transition: width 200ms ease-out;
}
</style>
