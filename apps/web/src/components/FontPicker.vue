<script setup lang="ts">
import type { ComboboxOption } from "~/components/ui/Combobox.vue";

const props = withDefaults(
  defineProps<{
    options: ComboboxOption[];
    label?: string;
    placeholder?: string;
    /** Value used when the setting means "follow the text font". */
    fallback?: string;
    disabled?: boolean;
  }>(),
  { label: "", placeholder: "", fallback: "", disabled: false },
);

const value = defineModel<string>({ default: "" });
const open = defineModel<boolean>("open", { default: false });
const query = defineModel<string>("query", { default: "" });

const emit = defineEmits<{ (e: "select", value: string): void }>();

const current = computed(() => props.options.find((option) => option.value === value.value));

/** The combobox sets `ignoreFilter`, so the caller narrows the list. */
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return props.options;

  return props.options.filter(
    (option) =>
      option.label.toLowerCase().includes(needle) ||
      (option.description ?? "").toLowerCase().includes(needle),
  );
});

// Every open starts from the full list: reka toggles `open` on the trigger.
watch(open, (isOpen) => {
  if (isOpen) query.value = "";
});

function pick(next: string): void {
  value.value = next;
  open.value = false;
  emit("select", next);
}
</script>

<template>
  <div class="font-picker">
    <UiCombobox
      v-model:open="open"
      v-model="query"
      :options="filtered"
      :label="label"
      :placeholder="placeholder"
      :disabled="disabled"
      @select="pick"
    >
      <template #trigger>
        <UiButton type="button" class="font-picker__trigger" :disabled="disabled">
          <span class="font-picker__value">{{ current?.label ?? value ?? fallback }}</span>
          <MsIcon name="unfold_more" :size="18" />
        </UiButton>
      </template>
    </UiCombobox>
  </div>
</template>

<style>
.font-picker {
  width: 100%;
}

/* The anchor is `inline-flex`, which shrinks to the label. A picker in a form
   row has to fill it, so the anchor stretches and the button takes the width.
   The class cannot go on `UiCombobox` itself: it forwards attrs to its content,
   so it would style the dropdown instead of the trigger. */
.font-picker .combobox__anchor {
  display: flex;
  width: 100%;
}

.font-picker__trigger {
  width: 100%;
  justify-content: space-between;
  gap: var(--space-2);
  text-align: left;
}

.font-picker__value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
