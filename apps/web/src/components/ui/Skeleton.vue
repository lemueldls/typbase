<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Any CSS length. Defaults to filling the parent. */
    width?: string;
    /** Any CSS length. */
    height?: string;
    /** Any CSS length. Use "0" for flush rows. */
    radius?: string;
  }>(),
  { width: "100%", height: "1rem", radius: "var(--radius-sm)" },
);
</script>

<template>
  <span class="ui-skeleton" :style="{ width, height, borderRadius: radius }" aria-hidden="true" />
</template>

<style>
.ui-skeleton {
  display: block;
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, var(--color-text) 6%, transparent) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: ui-skeleton-shimmer 1.2s ease-in-out infinite;
}

@keyframes ui-skeleton-shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ui-skeleton {
    animation: none;
    background: color-mix(in srgb, var(--color-text) 6%, transparent);
  }
}
</style>
