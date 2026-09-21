<script setup lang="ts">
import type { PageKind, PageMeta } from "@typbase/typing";

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
const kind = ref<PageKind>("document");
const error = ref<string>();
const creating = ref(false);

const categories = computed(() => props.store.listCategories());
const pathPreview = computed(() => `pages/${slugify(title.value || "untitled")}.typ`);

const kindOptions = computed(() => [
  { value: "document", label: t("newPage.kindDocument") },
  { value: "notebook", label: t("newPage.kindNotebook") },
]);

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
      kind: kind.value,
      categoryId: categoryId.value || null,
    });
    title.value = "";
    categoryId.value = "";
    kind.value = "document";
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
    :description="$t('newPage.description')"
  >
    <template #trigger>
      <slot />
    </template>

    <form class="dialog__form" @submit.prevent="submit">
      <Label class="dialog__field">
        <span>{{ $t("newPage.titleField") }}</span>
        <UiTextField v-model="title" placeholder="Project ideas" autofocus />
      </Label>

      <Label class="dialog__field">
        <span>{{ $t("newPage.kind") }}</span>
        <UiSelect v-model="kind" :options="kindOptions" :label="$t('newPage.kind')" />
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
          <UiButton variant="ghost">{{ $t("common.cancel") }}</UiButton>
        </DialogClose>
        <UiButton variant="primary" type="submit" :disabled="creating">
          {{ creating ? $t("common.working") : $t("newPage.create") }}
        </UiButton>
      </div>
    </form>
  </UiDialog>
</template>
