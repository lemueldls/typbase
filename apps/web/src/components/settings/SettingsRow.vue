<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string;
    /** Secondary line under the label. */
    hint?: string;
    /** Stable id used by the settings search. */
    anchor?: string;
    /** Extra words the search should match. */
    keywords?: string;
    /** Put the control under the label instead of beside it. */
    stacked?: boolean;
  }>(),
  {
    label: undefined,
    hint: undefined,
    anchor: undefined,
    keywords: undefined,
    stacked: false,
  },
);

function onRowClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (target.closest(".settings-row__control")) return;

  const row = event.currentTarget as HTMLElement | null;
  row?.querySelector<HTMLElement>('[role="switch"], [role="checkbox"]')?.click();
}
</script>

<template>
  <div
    :id="anchor ? `setting-${anchor}` : undefined"
    class="settings-row"
    :class="{ 'settings-row--stacked': stacked }"
    :data-settings-id="anchor ? `setting-${anchor}` : undefined"
    :data-settings-label="label"
    :data-settings-hint="hint"
    :data-settings-keywords="keywords"
    tabindex="-1"
    @click="onRowClick"
  >
    <div v-if="label || hint || $slots.description" class="settings-row__text">
      <span v-if="label" class="settings-row__label">{{ label }}</span>
      <span v-if="hint" class="settings-row__hint">{{ hint }}</span>
      <slot name="description" />
    </div>

    <div class="settings-row__control">
      <slot />
    </div>
  </div>
</template>

<style>
.settings-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 13rem);
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2-5) var(--space-3);
  scroll-margin-block: var(--space-4);
}

.settings-row__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.settings-row:focus {
  outline: none;
}

.settings-row:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.settings-row:has(.settings-row__control [role="switch"], .settings-row__control [role="checkbox"])
  .settings-row__text {
  cursor: pointer;
}

.settings-row__label {
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--color-text);
}

.settings-row__hint {
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.settings-row__control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  min-width: 0;
}

.settings-row__control .ui-select__trigger {
  width: 100%;
}

.settings-row--stacked {
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
}

.settings-row--stacked .settings-row__control {
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
}

.settings-row--stacked .settings-row__control > .button {
  align-self: flex-start;
}

.settings-row--flash {
  animation: settings-row-flash 1.2s var(--ease-out);
}

@keyframes settings-row-flash {
  0%,
  35% {
    background: var(--color-accent-soft);
  }

  100% {
    background: transparent;
  }
}

@container settings-panels (max-width: 38rem) {
  .settings-row {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-2);
  }

  .settings-row__control {
    justify-content: flex-start;
  }
}

@media (max-width: 48rem) {
  .settings-row {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-2);
  }

  .settings-row__control {
    justify-content: flex-start;
  }
}
</style>
