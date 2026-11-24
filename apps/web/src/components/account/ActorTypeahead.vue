<script setup lang="ts">
import type { MaterialSymbol } from "material-symbols";

import type { ActorSuggestion } from "~/lib/actor";

import { searchPublicActors } from "~/lib/actor";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    /** Accessible name. Use a visible label when the field needs one. */
    label?: string;
    placeholder?: string;
    disabled?: boolean;
    /** Leading glyph, usually a search or person icon. */
    icon?: MaterialSymbol;
    size?: "small" | "default";
    /** Shortest query that asks the AppView for suggestions. */
    minLength?: number;
  }>(),
  {
    modelValue: "",
    label: "",
    placeholder: "",
    disabled: false,
    icon: undefined,
    size: "default",
    minLength: 2,
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "select", suggestion: ActorSuggestion): void;
}>();

const attrs = useAttrs();
const inputAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs;

  return rest;
});

const open = ref(false);
const suggestions = ref<ActorSuggestion[]>([]);
let sequence = 0;
let pickedHandle: string | null = null;

const text = computed({
  get: () => props.modelValue,
  set: (value: string) => emit("update:modelValue", value),
});

const runSearch = useDebounceFn(async (value: string) => {
  const current = ++sequence;
  const results = await searchPublicActors(value);
  if (current !== sequence || props.disabled) return;

  suggestions.value = results;
  open.value = results.length > 0;
}, 180);

watch(
  () => props.modelValue,
  (value) => {
    suggestions.value = [];
    open.value = false;
    sequence++;

    // Picking a suggestion writes its handle back into the field. That is not a
    // new query, so keep the list closed instead of reopening on the same text.
    const picked = pickedHandle;
    pickedHandle = null;
    if (picked !== null && value === picked) return;

    const query = value.trim();
    if (props.disabled || query.length < props.minLength || query.startsWith("did:")) return;
    void runSearch(query);
  },
);

function pick(suggestion: ActorSuggestion): void {
  pickedHandle = suggestion.handle;
  open.value = false;
  suggestions.value = [];
  sequence++;
  emit("update:modelValue", suggestion.handle);
  emit("select", suggestion);
}
</script>

<template>
  <div class="actor-typeahead" :class="attrs.class" :style="attrs.style">
    <ComboboxRoot
      v-model:open="open"
      :disabled="disabled"
      ignore-filter
      :reset-search-term-on-blur="false"
      :reset-search-term-on-select="false"
    >
      <ComboboxAnchor as-child>
        <span
          class="ui-text-field actor-typeahead__field"
          :class="[`ui-text-field--${size}`, { 'ui-text-field--disabled': disabled }]"
        >
          <MsIcon v-if="icon" :name="icon" :size="size === 'small' ? 16 : 18" />
          <ComboboxInput
            v-bind="inputAttrs"
            v-model="text"
            class="ui-text-field__input"
            :aria-label="label"
            :placeholder="placeholder"
            :disabled="disabled"
          />
        </span>
      </ComboboxAnchor>

      <ComboboxPortal>
        <ComboboxContent
          class="actor-typeahead__suggestions"
          position="popper"
          align="start"
          :side-offset="4"
          :body-lock="false"
          hide-when-empty
        >
          <ComboboxViewport class="actor-typeahead__list">
            <ComboboxItem
              v-for="suggestion in suggestions"
              :key="suggestion.did"
              :value="suggestion.did"
              :text-value="suggestion.handle"
              class="actor-typeahead__suggestion"
              @select.prevent="pick(suggestion)"
            >
              <img
                v-if="suggestion.avatar"
                class="actor-typeahead__avatar"
                :src="suggestion.avatar"
                alt=""
              />
              <MsIcon
                v-else
                class="actor-typeahead__avatar actor-typeahead__avatar--icon"
                name="account_circle"
                :size="28"
              />
              <span class="actor-typeahead__copy">
                <span class="actor-typeahead__name">
                  {{ suggestion.displayName || suggestion.handle }}
                </span>
                <span class="actor-typeahead__handle">@{{ suggestion.handle }}</span>
              </span>
            </ComboboxItem>
          </ComboboxViewport>
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>
  </div>
</template>

<style>
.actor-typeahead {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.actor-typeahead__field {
  width: 100%;
}

.actor-typeahead__suggestions {
  z-index: var(--z-menu);
  width: var(--reka-combobox-trigger-width);
  padding: var(--space-1);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-2);
  animation: ui-overlay-fade-in var(--motion-fast);
}

.actor-typeahead__suggestions[data-state="closed"] {
  animation: ui-overlay-fade-out var(--motion-exit);
}

.actor-typeahead__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  max-height: 14rem;
  overflow-y: auto;
}

.actor-typeahead__suggestion {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  text-align: left;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
}

.actor-typeahead__suggestion:hover,
.actor-typeahead__suggestion[data-highlighted] {
  background: var(--color-accent-soft);
}

.actor-typeahead__avatar {
  flex: none;
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: 50%;
}

.actor-typeahead__avatar--icon {
  color: var(--color-text-tertiary);
}

.actor-typeahead__copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.actor-typeahead__name {
  font-size: var(--text-sm);
  color: var(--color-text);
}

.actor-typeahead__handle {
  overflow-wrap: anywhere;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}
</style>
