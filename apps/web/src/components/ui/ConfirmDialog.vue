<script setup lang="ts">
const open = defineModel<boolean>("open", { default: false });

withDefaults(
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
</script>

<template>
  <AlertDialogRoot v-model:open="open">
    <AlertDialogPortal>
      <AlertDialogOverlay class="dialog-overlay" />
      <AlertDialogContent class="dialog">
        <AlertDialogTitle class="dialog__title">{{ title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="description" class="dialog__description">
          {{ description }}
        </AlertDialogDescription>

        <div class="dialog__actions">
          <AlertDialogCancel as-child>
            <button type="button" class="button button--ghost">
              {{ cancelLabel ?? $t("common.cancel") }}
            </button>
          </AlertDialogCancel>
          <AlertDialogAction as-child>
            <button
              type="button"
              class="button"
              :class="danger ? 'button--danger' : 'button--primary'"
              @click="emit('confirm')"
            >
              {{ confirmLabel ?? $t("common.delete") }}
            </button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
