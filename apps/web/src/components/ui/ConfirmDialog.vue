<script setup lang="ts">
const open = defineModel<boolean>("open", { default: false });

const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    /** Defaults to "Cancel" / "Delete" from the common strings. */
    confirmLabel?: string;
    cancelLabel?: string;
    /** Danger styles the confirm button; set false for a neutral confirm. */
    danger?: boolean;
  }>(),
  { description: undefined, confirmLabel: undefined, cancelLabel: undefined, danger: true },
);

const emit = defineEmits<{ (e: "confirm"): void }>();

// Same reka-ui escape hatch as UiDialog: an empty description leaves the
// internal aria-describedby id pointing at nothing.
const describedBy = computed(() => (props.description ? {} : { "aria-describedby": undefined }));
</script>

<template>
  <AlertDialogRoot v-model:open="open">
    <AlertDialogPortal>
      <AlertDialogOverlay class="dialog-overlay" />
      <AlertDialogContent v-bind="describedBy" class="dialog">
        <AlertDialogTitle class="dialog__title">{{ title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="description" class="dialog__description">
          {{ description }}
        </AlertDialogDescription>

        <div class="dialog__actions">
          <AlertDialogCancel as-child>
            <UiButton variant="ghost">
              {{ cancelLabel ?? $t("common.cancel") }}
            </UiButton>
          </AlertDialogCancel>
          <AlertDialogAction as-child>
            <UiButton :variant="danger ? 'danger' : 'primary'" @click="emit('confirm')">
              {{ confirmLabel ?? $t("common.delete") }}
            </UiButton>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
