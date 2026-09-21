<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
  }>(),
  { title: undefined, description: undefined },
);

const attrs = useAttrs();

const open = defineModel<boolean>("open", { default: false });

const emit = defineEmits<{ (e: "openAutoFocus", event: Event): void }>();

// reka-ui always puts an internal aria-describedby id on DialogContent. With no
// DialogDescription rendered that id points at nothing and reka warns in dev,
// so drop the attribute when the description is empty. A caller-supplied
// description reference still wins.
const contentAttrs = computed(() => ({
  ...attrs,
  ...(!props.description && attrs["aria-describedby"] === undefined
    ? { "aria-describedby": undefined }
    : {}),
}));
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger v-if="$slots.trigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>

    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent
        v-bind="contentAttrs"
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
