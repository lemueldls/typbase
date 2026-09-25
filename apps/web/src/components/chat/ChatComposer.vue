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
  selection: string | null;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "update:providerId", value: string): void;
  (e: "update:model", value: string): void;
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
    <div v-if="pageTitle || selectionChars" class="chat-composer__context">
      <span v-if="pageTitle" class="chat-composer__chip">
        <MsIcon name="description" :size="14" aria-hidden="true" />
        {{ pageTitle }}
      </span>
      <span v-if="selectionChars" class="chat-composer__chip">
        <MsIcon name="highlight" :size="14" aria-hidden="true" />
        {{ $t("chat.selectionChip", { count: selectionChars }) }}
        <button
          type="button"
          class="chat-composer__chip-remove"
          :aria-label="$t('chat.clearSelection')"
          @click="emit('clearSelection')"
        >
          <MsIcon name="close" :size="12" />
        </button>
      </span>
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
          size="small"
          @update:model-value="emit('update:providerId', $event)"
        />
      </Label>
      <Label class="chat-composer__field chat-composer__field--model">
        <UiTextField
          v-model="modelDraft"
          size="small"
          :placeholder="t('chat.model')"
          :aria-label="t('chat.model')"
          @change="commitModel"
        />
      </Label>
      <span class="chat-composer__spacer" />
      <UiButton v-if="busy" variant="plain" size="small" @click="emit('stop')">
        <MsIcon name="stop" :size="16" />
        {{ $t("chat.stop") }}
      </UiButton>
      <UiButton
        v-else
        variant="primary"
        size="small"
        :disabled="!modelValue.trim()"
        @click="emit('send')"
      >
        <MsIcon name="send" :size="16" />
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
  padding: var(--space-2-5) var(--space-3);
  border-top: 1px solid var(--color-border);
}

.chat-composer__context {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  flex-wrap: wrap;
}

.chat-composer__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-0-5) var(--space-1-5);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}

.chat-composer__chip-remove {
  display: inline-flex;
  padding: 0;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}

.chat-composer__input {
  width: 100%;
  min-height: 3.5rem;
  max-height: 14rem;
  padding: var(--space-2);
  font: inherit;
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
