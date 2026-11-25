<script setup lang="ts">
import {
  AccordionContent as RekaAccordionContent,
  AccordionHeader as RekaAccordionHeader,
  AccordionItem as RekaAccordionItem,
  AccordionTrigger as RekaAccordionTrigger,
} from "reka-ui";

withDefaults(
  defineProps<{
    value: string;
    disabled?: boolean;
  }>(),
  { disabled: false },
);
</script>

<template>
  <RekaAccordionItem :value="value" :disabled="disabled" class="ui-accordion__item">
    <RekaAccordionHeader class="ui-accordion__header">
      <RekaAccordionTrigger class="ui-accordion__trigger">
        <MsIcon class="ui-accordion__chevron" name="chevron_right" :size="20" />
        <slot name="trigger" />
      </RekaAccordionTrigger>

      <div v-if="$slots.actions" class="ui-accordion__actions">
        <slot name="actions" />
      </div>
    </RekaAccordionHeader>

    <RekaAccordionContent class="ui-accordion__content">
      <slot />
    </RekaAccordionContent>
  </RekaAccordionItem>
</template>
