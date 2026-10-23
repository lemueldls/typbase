<script setup lang="ts">
defineProps<{
  /** Section title. */
  title?: string;
  /** One line about what the group controls. */
  hint?: string;
  /** Stable id used by the settings search. */
  anchor?: string;
}>();
</script>

<template>
  <section
    :id="anchor ? `section-${anchor}` : undefined"
    class="settings-section"
    :data-settings-section-id="anchor ? `section-${anchor}` : undefined"
    :data-settings-section-label="title"
    :data-settings-section-hint="hint"
    tabindex="-1"
  >
    <header v-if="title || hint" class="settings-section__header">
      <h3 v-if="title" class="settings-section__title">{{ title }}</h3>
      <p v-if="hint" class="settings-section__hint">{{ hint }}</p>
    </header>

    <div class="settings-section__rows">
      <slot />
    </div>
  </section>
</template>

<style>
.settings-section {
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  scroll-margin-block: var(--space-4);
}

.settings-section:focus {
  outline: none;
}

.settings-section:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.settings-section--flash {
  animation: settings-section-flash 1.2s var(--ease-out);
}

@keyframes settings-section-flash {
  0%,
  35% {
    box-shadow: 0 0 0 2px var(--color-accent);
  }

  100% {
    box-shadow: 0 0 0 2px transparent;
  }
}

.settings-section__header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3) var(--space-3) var(--space-1);
}

.settings-section__title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.settings-section__hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.settings-section__rows {
  display: flex;
  flex-direction: column;
}

.settings-section__rows > * + * {
  border-top: 1px solid var(--color-border);
}
</style>
