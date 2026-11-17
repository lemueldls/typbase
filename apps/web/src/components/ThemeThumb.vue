<script setup lang="ts">
import { backdropFor } from "@typbase/skin";

/** Colors a mini app window draws from. `backdrop` falls back to a derived plane. */
interface ThemeThumbPalette {
  surface: string;
  surface2: string;
  surface3: string;
  text: string;
  accent: string;
  code: string;
  backdrop?: string;
}

const props = defineProps<{
  palette: ThemeThumbPalette;
  mode: "light" | "dark";
}>();

const vars = computed(() => ({
  "--theme-thumb-backdrop": props.palette.backdrop ?? backdropFor(props.palette, props.mode),
  "--theme-thumb-surface": props.palette.surface,
  "--theme-thumb-surface-2": props.palette.surface2,
  "--theme-thumb-text": props.palette.text,
  "--theme-thumb-accent": props.palette.accent,
  "--theme-thumb-code": props.palette.code,
}));
</script>

<template>
  <span class="theme-thumb" :style="vars" aria-hidden="true">
    <span class="theme-thumb__rail">
      <span class="theme-thumb__mark" />
      <span class="theme-thumb__nav theme-thumb__nav--active" />
      <span class="theme-thumb__nav" />
      <span class="theme-thumb__nav theme-thumb__nav--short" />
    </span>
    <span class="theme-thumb__page">
      <span class="theme-thumb__heading" />
      <span class="theme-thumb__line" />
      <span class="theme-thumb__line theme-thumb__line--short" />
      <span class="theme-thumb__footer">
        <span class="theme-thumb__pill" />
        <span class="theme-thumb__code" />
      </span>
    </span>
  </span>
</template>

<style>
.theme-thumb {
  display: grid;
  grid-template-columns: 1.4rem minmax(0, 1fr);
  gap: 0.35rem;
  height: 4.75rem;
  padding: 0.35rem;
  overflow: hidden;
  background: var(--theme-thumb-backdrop);
  border: 1px solid rgb(127 127 127 / 0.24);
  border-radius: var(--radius-sm);
}

.theme-thumb__rail {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding-top: 0.1rem;
}

.theme-thumb__mark {
  width: 0.55rem;
  height: 0.55rem;
  background: var(--theme-thumb-accent);
  border-radius: calc(var(--radius-xs) * 0.8);
}

.theme-thumb__nav {
  width: 100%;
  height: 0.2rem;
  background: color-mix(in srgb, var(--theme-thumb-text) 32%, transparent);
  border-radius: var(--radius-full);
}

.theme-thumb__nav--active {
  height: 0.45rem;
  background: var(--theme-thumb-surface-2);
}

.theme-thumb__nav--short {
  width: 68%;
}

.theme-thumb__page {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  min-width: 0;
  padding: 0.4rem 0.45rem;
  background: var(--theme-thumb-surface);
  border: 1px solid color-mix(in srgb, var(--theme-thumb-text) 10%, transparent);
  border-radius: calc(var(--radius-sm) * 0.8);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.14);
}

.theme-thumb__heading {
  width: 55%;
  height: 0.3rem;
  background: var(--theme-thumb-text);
  border-radius: var(--radius-full);
  opacity: 0.9;
}

.theme-thumb__line {
  height: 0.18rem;
  background: var(--theme-thumb-text);
  border-radius: var(--radius-full);
  opacity: 0.38;
}

.theme-thumb__line--short {
  width: 65%;
}

.theme-thumb__footer {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: auto;
}

.theme-thumb__pill {
  width: 1.35rem;
  height: 0.4rem;
  background: var(--theme-thumb-accent);
  border-radius: var(--radius-full);
}

.theme-thumb__code {
  width: 1.6rem;
  height: 0.4rem;
  background: var(--theme-thumb-code);
  border: 1px solid color-mix(in srgb, var(--theme-thumb-text) 12%, transparent);
  border-radius: calc(var(--radius-xs) * 0.8);
}
</style>
