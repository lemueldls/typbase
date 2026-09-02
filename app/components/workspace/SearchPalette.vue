<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import type { SearchResultItem } from "~/lib/search";

import { useSearch } from "~/composables/search";
import { requestReveal } from "~/lib/reveal";

const props = defineProps<{
  store: WorkspaceStore;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const { search } = useSearch();

const query = ref("");
const results = ref<SearchResultItem[]>([]);
const active = ref(0);
const searching = ref(false);

const input = useTemplateRef("input");

const runSearch = useDebounceFn(async (value: string) => {
  const s = search.value!;
  if (s) {
    searching.value = true;
    try {
      results.value = await s.query(value);
      active.value = 0;
    } finally {
      searching.value = false;
    }
  } else {
    results.value = [];
    searching.value = false;
  }
}, 220);

watch(query, (value) => {
  if (!value.trim()) {
    results.value = [];
    return;
  }

  void runSearch(value);
});

onMounted(() => {
  input.value?.focus();
});

function onKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    active.value = Math.min(results.value.length - 1, active.value + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    active.value = Math.max(0, active.value - 1);
  } else if (event.key === "Enter") {
    const result = results.value[active.value];
    if (result) open(result);
  } else if (event.key === "Escape") {
    emit("close");
  }
}

function open(result: SearchResultItem) {
  if (result.rawRange) {
    requestReveal(result.docId, result.rawRange.from, result.rawRange.to);
  }
  emit("close");
}
</script>

<template>
  <div class="search-palette" @keydown="onKeydown" @click.self="emit('close')">
    <div class="search-palette__box" role="dialog" aria-label="Search">
      <div class="search-palette__field">
        <Icon name="lucide:search" :size="16" aria-hidden="true" class="search-palette__icon" />
        <input
          ref="input"
          v-model="query"
          class="search-palette__input"
          placeholder="Search pages and blocks..."
          aria-label="Search pages and blocks"
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
        />
      </div>
      <p v-if="searching" class="search-palette__hint" role="status">Searching...</p>
      <ul
        v-else-if="results.length"
        class="search-palette__results"
        role="listbox"
        id="search-results"
      >
        <li
          v-for="(result, index) in results"
          :key="`${result.docId}:${result.blockIndex}`"
          role="option"
          :aria-selected="index === active"
          class="search-palette__result"
          :class="{ 'search-palette__result--active': index === active }"
          @mousemove="active = index"
          @click="open(result)"
        >
          <div class="search-palette__title">
            <span>{{ result.title || result.path }}</span>
            <span class="search-palette__kind">{{ result.kind }}</span>
          </div>
          <div class="search-palette__snippet">{{ result.snippet }}</div>
        </li>
      </ul>
      <p v-else-if="query.trim()" class="search-palette__hint">No matches.</p>
      <p v-else class="search-palette__hint">Type to search every block in the workspace.</p>
    </div>
  </div>
</template>

<style scoped>
.search-palette {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  justify-content: center;
  padding-top: 12vh;
  background: rgb(0 0 0 / 0.3);
}

.search-palette__box {
  width: min(560px, calc(100vw - 2rem));
  max-height: 60vh;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  box-shadow: 0 24px 70px rgb(0 0 0 / 0.3);
  padding: 0.5rem;
}

.search-palette__field {
  position: relative;
}

.search-palette__icon {
  position: absolute;
  left: 0.7rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-secondary);
  pointer-events: none;
}

.search-palette__input {
  width: 100%;
  padding: 0.6rem 0.75rem 0.6rem 2.2rem;
  font-size: 1rem;
  font-family: inherit;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--surface-2);
  color: var(--text);
  outline: none;
}

.search-palette__input:focus {
  border-color: var(--accent);
}

.search-palette__hint {
  margin: 0.6rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.search-palette__results {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
}

.search-palette__result {
  padding: 0.5rem 0.6rem;
  border-radius: 0.45rem;
  cursor: pointer;
}

.search-palette__result--active {
  background: var(--accent-soft);
}

.search-palette__title {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.9rem;
  font-weight: 600;
}

.search-palette__kind {
  font-weight: 400;
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.search-palette__snippet {
  margin-top: 0.15rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
}
</style>
