<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    /** "top" stacks this dialog above another dialog that is already open. */
    layer?: "default" | "top";
  }>(),
  { title: undefined, description: undefined, layer: "default" },
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
      <DialogOverlay class="dialog-overlay" :class="{ 'dialog-overlay--top': layer === 'top' }" />
      <DialogContent
        v-bind="contentAttrs"
        class="dialog"
        :class="{ 'dialog--top': layer === 'top' }"
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

<style>
/* Shared by UiDialog and UiConfirmDialog, which renders the same classes. */
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: var(--color-overlay);
}

.dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(420px, calc(100vw - var(--space-8)));
  max-height: calc(100dvh - var(--space-16) - var(--safe-top) - var(--safe-bottom));
  overflow-y: auto;
  padding: var(--space-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px rgb(0 0 0 / 0.2);
  z-index: 75;
}

.dialog-overlay,
.dialog {
  animation: ui-overlay-fade-in 100ms ease-out;
}

.dialog-overlay[data-state="closed"],
.dialog[data-state="closed"] {
  animation: ui-overlay-fade-out 80ms ease-in;
}

.dialog__title {
  margin: 0 0 var(--space-4);
  font-size: var(--text-2xl);
}

/* Dialogs opened from another dialog (Settings → updates) need a higher layer:
   portaled content mounts in open order, so a dialog that opened first would
   otherwise sit above it. Below selects (90), toasts (95), and tooltips (100). */
.dialog-overlay--top {
  z-index: 80;
}

.dialog--top {
  z-index: 85;
}

.dialog__description {
  margin: 0 0 var(--space-4);
  font-size: var(--text-md);
  color: var(--color-text-secondary);
}

.dialog__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.dialog__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-md);
  color: var(--color-text-secondary);
}

.dialog__path {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
}

.dialog__error {
  margin: 0;
  font-size: var(--text-md);
  color: var(--color-danger);
}

.dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
</style>
