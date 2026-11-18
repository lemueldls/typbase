import { computed, shallowRef } from "vue";

/**
 * What the confirm dialog shows. Labels are passed already translated: callers
 * hold the i18n composer, this module stays free of the Nuxt runtime.
 */
export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Danger styles the confirm button. Defaults to true, like UiConfirmDialog. */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

const pending = shallowRef<PendingConfirm | null>(null);

const open = computed(() => pending.value !== null);

/**
 * Settles the open request. Closing with Escape or Cancel counts as a no;
 * confirming settles first, so the dialog's close event that follows does not
 * turn it into a no.
 */
function settle(confirmed: boolean): void {
  const request = pending.value;
  pending.value = null;
  request?.resolve(confirmed);
}

/**
 * Asks the user to confirm an action and resolves once the dialog closes.
 * A second call resolves the first as cancelled, so only one request owns the
 * dialog. The shell mounts the dialog once; `ConfirmDialogHost` feeds it.
 */
function confirm(options: ConfirmOptions): Promise<boolean> {
  if (pending.value) settle(false);

  return new Promise((resolve) => {
    pending.value = { ...options, resolve };
  });
}

export function useConfirm() {
  return { pending, open, confirm, settle };
}
