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
  <UiDialog
    v-model:open="open"
    :title="$t('categories.title')"
    :description="$t('categories.description')"
  >
    <template #trigger>
      <slot />
    </template>

    <ul class="category-list">
      <li v-for="category in categories" :key="category.id" class="category-list__row">
        <span>{{ category.name }}</span>
        <span class="category-list__count">{{ categoryCounts.get(category.id) ?? 0 }}</span>
        <UiIconButton
          icon="delete"
          :size="16"
          :label="$t('categories.removeAria', { name: category.name })"
          @click="remove(category.id)"
        />
      </li>
      <li v-if="categories.length === 0" class="category-list__empty">
        {{ $t("categories.none") }}
      </li>
    </ul>

    <form class="dialog__form" @submit.prevent="add">
      <div class="dialog__field">
        <UiTextField v-model="newName" :placeholder="$t('categories.label')" />
      </div>
      <UiButton variant="primary" type="submit">{{ $t("categories.add") }}</UiButton>
    </form>
    <p v-if="error" class="dialog__error">{{ error }}</p>

    <div class="dialog__actions">
      <DialogClose as-child>
        <UiButton variant="ghost">{{ $t("common.close") }}</UiButton>
      </DialogClose>
    </div>
  </UiDialog>
</template>

<style scoped>
.category-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-height: 16rem;
  overflow-y: auto;
}

.category-list__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-1-5);
  border-radius: var(--radius-xs);
}

.category-list__row:hover {
  background: var(--color-surface-2);
}

.category-list__count {
  margin-left: auto;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.category-list__empty {
  color: var(--color-text-secondary);
  padding: var(--space-2) var(--space-1);
}
</style>
