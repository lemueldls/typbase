<script setup lang="ts">
import type { PageMeta } from "@typbase/typing";

import { slugify, type WorkspaceStore } from "@typbase/storage";

const props = defineProps<{
  store: WorkspaceStore;
}>();

const emit = defineEmits<{
  (e: "created", page: PageMeta): void;
}>();

const open = defineModel<boolean>("open", { default: false });

const title = ref("");
const categoryId = ref<string>("");
const error = ref<string>();
const creating = ref(false);

const categories = computed(() => props.store.listCategories());
const pathPreview = computed(() => `pages/${slugify(title.value || "untitled")}.typ`);

async function submit() {
  const trimmed = title.value.trim();
  if (!trimmed) {
    error.value = "Give the page a title.";
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
  <DialogRoot v-model:open="open">
    <DialogTrigger as-child>
      <slot />
    </DialogTrigger>

    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog">
        <DialogTitle class="dialog__title">New page</DialogTitle>
        <DialogDescription class="dialog__description">
          Pages are Typst sources. The path comes from the title.
        </DialogDescription>

        <form class="dialog__form" @submit.prevent="submit">
          <label class="dialog__field">
            <span>Title</span>
            <input v-model="title" class="dialog__input" placeholder="Project ideas" autofocus />
          </label>

          <label class="dialog__field">
            <span>Category</span>
            <select v-model="categoryId" class="dialog__input">
              <option value="">No category</option>
              <option v-for="category in categories" :key="category.id" :value="category.id">
                {{ category.name }}
              </option>
            </select>
          </label>

          <p class="dialog__path">{{ pathPreview }}</p>
          <p v-if="error" class="dialog__error">{{ error }}</p>

          <div class="dialog__actions">
            <DialogClose as-child>
              <button type="button" class="button button--ghost">Cancel</button>
            </DialogClose>
            <button type="submit" class="button button--primary" :disabled="creating">
              {{ creating ? "Creating..." : "Create" }}
            </button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
