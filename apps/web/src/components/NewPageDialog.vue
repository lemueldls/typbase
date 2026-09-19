<script setup lang="ts">
import type { PageMeta } from "@typbase/typing";

import { slugify, type WorkspaceStore } from "@typbase/storage";

const props = defineProps<{
  store: WorkspaceStore;
}>();

const emit = defineEmits<{
  (e: "created", page: PageMeta): void;
}>();

const { t } = useI18n();
const open = defineModel<boolean>("open", { default: false });

const title = ref("");
const categoryId = ref<string>("");
const error = ref<string>();
const creating = ref(false);

const categories = computed(() => props.store.listCategories());
const pathPreview = computed(() => `pages/${slugify(title.value || "untitled")}.typ`);

// Reka rejects an empty item value, so "no category" is a sentinel here.
const categoryChoice = computed({
  get: () => categoryId.value || "none",
  set: (value: string) => {
    categoryId.value = value === "none" ? "" : value;
  },
});

const categoryOptions = computed(() => [
  { value: "none", label: t("newPage.noCategory") },
  ...categories.value.map((category) => ({ value: category.id, label: category.name })),
]);

async function submit() {
  const trimmed = title.value.trim();
  if (!trimmed) {
    error.value = t("newPage.givingTitle");
    return;
  }

  creating.value = true;
  error.value = undefined;

  try {
    const page = await props.store.createPage({
      title: trimmed,
      categoryId: categoryId.value || null,
    });
    title.value = "";
    categoryId.value = "";
    open.value = false;
    emit("created", page);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    :title="$t('newPage.title')"
    description="Pages are Typst sources. The path comes from the title."
  >
    <template #trigger>
      <slot />
    </template>

    <form class="dialog__form" @submit.prevent="submit">
      <Label class="dialog__field">
        <span>{{ $t("newPage.titleField") }}</span>
        <input v-model="title" class="dialog__input" placeholder="Project ideas" autofocus />
      </Label>

      <Label class="dialog__field">
        <span>{{ $t("newPage.category") }}</span>
        <UiSelect
          v-model="categoryChoice"
          :options="categoryOptions"
          :label="$t('newPage.category')"
        />
      </Label>

      <p class="dialog__path">{{ pathPreview }}</p>
      <p v-if="error" class="dialog__error">{{ error }}</p>

      <div class="dialog__actions">
        <DialogClose as-child>
          <button type="button" class="button button--ghost">{{ $t("common.cancel") }}</button>
        </DialogClose>
        <button type="submit" class="button button--primary" :disabled="creating">
          {{ creating ? $t("common.working") : $t("newPage.create") }}
        </button>
      </div>
    </form>
  </UiDialog>
</template>
