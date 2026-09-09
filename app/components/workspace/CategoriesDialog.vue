<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

const props = defineProps<{
  store: WorkspaceStore;
}>();

const open = defineModel<boolean>("open", { default: false });

const newName = ref("");
const error = ref<string>();

const categories = computed(() => props.store.listCategories());
const categoryCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const page of props.store.listPages()) {
    if (page.categoryId) {
      counts.set(page.categoryId, (counts.get(page.categoryId) ?? 0) + 1);
    }
  }

  return counts;
});

async function add() {
  if (!newName.value.trim()) return;

  error.value = undefined;
  try {
    await props.store.addCategory(newName.value);
    newName.value = "";
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

async function remove(id: string) {
  await props.store.removeCategory(id);
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger as-child>
      <slot />
    </DialogTrigger>

    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog">
        <DialogTitle class="dialog__title">{{ $t("categories.title") }}</DialogTitle>
        <DialogDescription class="dialog__description">
          Pages group under categories; the sidebar lists them by category.
        </DialogDescription>

        <ul class="category-list">
          <li v-for="category in categories" :key="category.id" class="category-list__row">
            <span>{{ category.name }}</span>
            <span class="category-list__count">{{ categoryCounts.get(category.id) ?? 0 }}</span>
            <button
              type="button"
              class="button button--icon"
              :aria-label="$t('categories.removeAria', { name: category.name })"
              @click="remove(category.id)"
            >
              ×
            </button>
          </li>
          <li v-if="categories.length === 0" class="category-list__empty">
            {{ $t("categories.none") }}
          </li>
        </ul>

        <form class="dialog__form" @submit.prevent="add">
          <div class="dialog__field">
            <input v-model="newName" class="dialog__input" :placeholder="$t('categories.label')" />
          </div>
          <button type="submit" class="button button--primary">{{ $t("categories.add") }}</button>
        </form>
        <p v-if="error" class="dialog__error">{{ error }}</p>

        <div class="dialog__actions">
          <DialogClose as-child>
            <button type="button" class="button button--ghost">Close</button>
          </DialogClose>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.category-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 16rem;
  overflow-y: auto;
}

.category-list__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.4rem;
  border-radius: 0.3rem;
}

.category-list__row:hover {
  background: var(--color-surface-2);
}

.category-list__count {
  margin-left: auto;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}

.category-list__empty {
  color: var(--color-text-secondary);
  padding: 0.5rem 0.2rem;
}
</style>
