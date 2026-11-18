<script setup lang="ts">
const open = defineModel<boolean>("open", { default: false });

// Back closes the confirm before it leaves the app.
useBackLayer(open);

const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    /** Defaults to "Cancel" / "Delete" from the common strings. */
    confirmLabel?: string;
    cancelLabel?: string;
    /** Danger styles the confirm button. Set false for a neutral confirm. */
    danger?: boolean;
  }>(),
  { description: undefined, confirmLabel: undefined, cancelLabel: undefined, danger: true },
);

const emit = defineEmits<{ (e: "confirm"): void }>();

// Confirm runs before the dialog closes, so a handler can still read the state
// its request was built from. The promise-based useConfirm() relies on that
// order: it settles the request first and lets the close event be a no-op.
function confirm(): void {
  emit("confirm");
  open.value = false;
}

// Same reka-ui escape hatch as UiDialog: an empty description leaves the
// internal aria-describedby id pointing at nothing.
const describedBy = computed(() => (props.description ? {} : { "aria-describedby": undefined }));
</script>

<template>
  <AlertDialogRoot v-model:open="open">
    <AlertDialogPortal>
      <AlertDialogOverlay class="dialog-overlay dialog-overlay--confirm" />
      <AlertDialogContent v-bind="describedBy" class="dialog dialog--confirm">
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
          <UiButton :variant="danger ? 'danger' : 'primary'" @click="confirm">
            {{ confirmLabel ?? $t("common.delete") }}
          </UiButton>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style>
.dialog-overlay--confirm {
  z-index: calc(var(--z-dialog-top) + 1);
}

.dialog--confirm {
  z-index: calc(var(--z-dialog-top) + 4);
}
</style>
