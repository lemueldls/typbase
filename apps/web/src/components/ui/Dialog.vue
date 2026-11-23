<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    /** "top" stacks this dialog above another dialog that is already open. */
    layer?: "default" | "top";
    /** Show the corner close button. Footer Cancel/Close dialogs can opt out. */
    closable?: boolean;
  }>(),
  { title: undefined, description: undefined, layer: "default", closable: true },
);

const attrs = useAttrs();

const open = defineModel<boolean>("open", { default: false });

// Back closes the dialog before it leaves the app.
useBackLayer(open);

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
        :class="{ 'dialog--top': layer === 'top', 'dialog--closable': closable }"
        @open-auto-focus="emit('openAutoFocus', $event)"
      >
        <DialogTitle v-if="title" class="dialog__title">{{ title }}</DialogTitle>
        <DialogDescription v-if="description" class="dialog__description">
          {{ description }}
        </DialogDescription>
        <slot />
        <DialogClose
          v-if="closable"
          type="button"
          class="dialog__close"
          :aria-label="$t('common.close')"
        >
          <MsIcon name="close" :size="20" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
/* Shared by UiDialog and UiConfirmDialog, which renders the same classes. */
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  background: var(--color-overlay);
}

/* Variants change the box with `.dialog.<variant>`: CSS chunks can load in any
   order, so an equal-specificity class would lose to this rule. */
.dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(420px, calc(100vw - var(--space-8)));
  max-height: calc(100dvh - var(--space-16) - var(--safe-top) - var(--safe-bottom));
  overflow-y: auto;
  padding: var(--dialog-pad);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-3);
  z-index: var(--z-dialog);
}

.dialog-overlay,
.dialog {
  animation: ui-overlay-fade-in var(--motion-fast);
}

.dialog-overlay[data-state="closed"],
.dialog[data-state="closed"] {
  animation: ui-overlay-fade-out var(--motion-exit);
}

.dialog__title {
  margin: 0 0 var(--space-4);
  font-size: var(--text-2xl);
}

.dialog--closable .dialog__title {
  padding-right: calc(var(--control-sm) + var(--space-3));
}

.dialog__close {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  display: grid;
  place-items: center;
  width: var(--control-sm);
  height: var(--control-sm);
  padding: 0;
  color: var(--color-text-secondary);
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.dialog__close:hover {
  color: var(--color-text);
  background: var(--color-surface-2);
}

.dialog__close:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* Dialogs opened from another dialog (Settings → updates) need a higher layer:
   portaled content mounts in open order, so a dialog that opened first would
   otherwise sit above it. Below selects (90), toasts (95), and tooltips (100). */
.dialog-overlay--top {
  z-index: var(--z-dialog-top);
}

.dialog--top {
  z-index: calc(var(--z-dialog-top) + 5);
}

.dialog__description {
  margin: 0 0 var(--space-4);
  font-size: var(--text-md);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
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

/* Secondary line under a field, e.g. what a toggle will do. */
.dialog__hint {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
</style>
