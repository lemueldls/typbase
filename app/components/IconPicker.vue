<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

import { searchSymbols, type SymbolEntry } from "~/lib/symbols";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** How many results render before "refine your search" is shown. */
    limit?: number;
  }>(),
  { limit: 300 },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: MaterialSymbol): void;
}>();

const query = ref("");
const gridRef = useTemplateRef<HTMLElement>("grid");

const result = computed(() => searchSymbols(query.value, props.limit));

watch(query, () => {
  gridRef.value?.scrollTo({ top: 0 });
});

function pick(entry: SymbolEntry) {
  emit("update:modelValue", entry.id);
}

const selected = computed(() => props.modelValue as MaterialSymbol);
</script>

<template>
  <div class="icon-picker">
    <div class="icon-picker__search">
      <MsIcon name="search" :size="16" />
      <input
        v-model="query"
        class="icon-picker__input"
        :placeholder="$t('switcher.iconSearch')"
        :aria-label="$t('switcher.iconSearch')"
        type="search"
        @keydown.enter.prevent
      />
    </div>

    <div ref="grid" class="icon-picker__grid">
      <UiTooltip v-for="entry in result.entries" :key="entry.id" :text="entry.title">
        <button
          type="button"
          class="icon-picker__cell"
          :class="{ 'icon-picker__cell--selected': entry.id === selected }"
          :aria-pressed="entry.id === selected"
          :aria-label="entry.title"
          @click="pick(entry)"
        >
          <MsIcon :name="entry.id" :size="20" />
        </button>
      </UiTooltip>
    </div>

    <p v-if="result.total > result.entries.length" class="icon-picker__hint">
      {{ $t("switcher.iconMore", { shown: result.entries.length, total: result.total }) }}
    </p>
  </div>
</template>

<style scoped>
.icon-picker {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.icon-picker__search {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.55rem;
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: 0.4rem;
}

.icon-picker__input {
  flex: 1;
  min-width: 0;
  font-size: 0.875rem;
  font-family: inherit;
  color: var(--color-text);
  background: transparent;
  border: none;
  outline: none;
}

.icon-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(2.4rem, 1fr));
  gap: 0.25rem;
  max-height: 14rem;
  overflow-y: auto;
  padding: 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: 0.4rem;
}

.icon-picker__cell {
  display: grid;
  place-content: center;
  aspect-ratio: 1;
  padding: 0.25rem;
  color: var(--color-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0.35rem;
  cursor: pointer;
}

.icon-picker__cell:hover {
  background: var(--color-surface-3);
}

.icon-picker__cell--selected {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}

.icon-picker__hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}
</style>
