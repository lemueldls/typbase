<script setup lang="ts">
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    title?: string;
    description?: string;
  }>(),
  { title: undefined, description: undefined },
);

const open = defineModel<boolean>("open", { default: false });

const emit = defineEmits<{ (e: "openAutoFocus", event: Event): void }>();
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger v-if="$slots.trigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>

    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent
        v-bind="$attrs"
        class="dialog"
        @open-auto-focus="emit('openAutoFocus', $event)"
      >
        <DialogTitle v-if="title" class="dialog__title">{{ title }}</DialogTitle>
        <DialogDescription v-if="description" class="dialog__description">
          {{ description }}
        </DialogDescription>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
