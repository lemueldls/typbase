<script setup lang="ts">
import type { AiProviderSettings } from "@typbase/typing";

import type { SelectOption } from "~/components/ui/Select.vue";

const props = defineProps<{
  modelValue: string;
  busy: boolean;
  providers: AiProviderSettings[];
  providerId: string | null;
  model: string | null;
  pageTitle: string | null;
  pages: Array<{ id: string; title: string; path: string }>;
  selection: string | null;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "update:providerId", value: string): void;
  (e: "update:model", value: string): void;
  (e: "update:page", value: string | null): void;
  (e: "send"): void;
  (e: "stop"): void;
  (e: "clearSelection"): void;
}>();

const { t } = useI18n();

const providerOptions = computed<SelectOption[]>(() =>
  props.providers.map((provider) => ({ value: provider.id, label: provider.name })),
);

const modelDraft = ref(props.model ?? "");
watch(
  () => props.model,
  (value) => {
    modelDraft.value = value ?? "";
  },
);

const selectionChars = computed(() => props.selection?.length ?? 0);

const pagePickerOpen = ref(false);
const pageQuery = ref("");
/** Reka rejects an empty item value, so detaching gets its own sentinel. */
const NO_PAGE = "none";

/** Options arrive pre-filtered: UiCombobox sets ignoreFilter. */
const pageOptions = computed(() => {
  const needle = pageQuery.value.trim().toLowerCase();
  const options = [
    { value: NO_PAGE, label: t("chat.noPage"), description: "" },
    ...props.pages.map((page) => ({
      value: page.id,
      label: page.title,
      description: page.path,
    })),
  ];
  if (!needle) return options;

  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(needle) ||
      option.description.toLowerCase().includes(needle),
  );
});

watch(pagePickerOpen, (open) => {
  if (open) pageQuery.value = "";
});

function selectPage(value: string): void {
  pagePickerOpen.value = false;
  emit("update:page", value === NO_PAGE ? null : value);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  emit("send");
}

function commitModel(): void {
  emit("update:model", modelDraft.value.trim());
}
</script>

<template>
  <div class="chat-composer">
    <div class="chat-composer__context">
      <UiCombobox
        v-model:open="pagePickerOpen"
        v-model="pageQuery"
        :options="pageOptions"
        :label="t('chat.changePage')"
        :placeholder="t('links.searchPages')"
        :empty="t('links.noPages')"
        side="top"
        @select="selectPage"
      >
        <template #trigger>
          <UiChip as="button" type="button" class="chat-composer__page-chip">
            <template #leading>
              <MsIcon name="description" :size="14" aria-hidden="true" />
            </template>
            {{ pageTitle ?? t("chat.noPage") }}
            <template #trailing>
              <MsIcon name="keyboard_arrow_down" :size="14" aria-hidden="true" />
            </template>
          </UiChip>
        </template>
      </UiCombobox>

      <UiChip
        v-if="selectionChars"
        removable
        :remove-label="$t('chat.clearSelection')"
        @remove="emit('clearSelection')"
      >
        <template #leading>
          <MsIcon name="highlight" :size="14" aria-hidden="true" />
        </template>
        {{ $t("chat.selectionChip", { count: selectionChars }) }}
      </UiChip>
    </div>

    <textarea
      class="chat-composer__input"
      :value="modelValue"
      :placeholder="t('chat.placeholder')"
      rows="3"
      :disabled="busy"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @keydown="onKeydown"
    />

    <div class="chat-composer__row">
      <Label class="chat-composer__field">
        <UiSelect
          v-if="providerOptions.length"
          :model-value="providerId ?? providerOptions[0]!.value"
          :options="providerOptions"
          :label="t('chat.provider')"
          @update:model-value="emit('update:providerId', $event)"
        />
      </Label>
      <Label class="chat-composer__field chat-composer__field--model">
        <UiTextField
          v-model="modelDraft"
          :placeholder="t('chat.model')"
          :aria-label="t('chat.model')"
          @change="commitModel"
        />
      </Label>
      <span class="chat-composer__spacer" />
      <UiButton v-if="busy" variant="plain" @click="emit('stop')">
        <MsIcon name="stop_circle" :size="20" />
        {{ $t("chat.stop") }}
      </UiButton>
      <UiButton v-else variant="primary" :disabled="!modelValue.trim()" @click="emit('send')">
        <MsIcon name="send" :size="20" />
        {{ $t("chat.send") }}
      </UiButton>
    </div>
  </div>
</template>

<style>
.chat-composer {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  border-top: 1px solid var(--color-border);
}

.chat-composer__context {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  flex-wrap: wrap;
}

.chat-composer__input {
  width: 100%;
  min-height: 3.5rem;
  max-height: 14rem;
  padding: var(--space-2);
  font-family: inherit;
  font-size: var(--text-md);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  resize: vertical;
}

.chat-composer__input:focus {
  outline: 2px solid var(--color-accent);
  outline-offset: -1px;
}

.chat-composer__row {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
}

.chat-composer__field {
  display: inline-flex;
  min-width: 8rem;
}

.chat-composer__field--model {
  min-width: 10rem;
}

.chat-composer__spacer {
  flex: 1;
}
</style>
