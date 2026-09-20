import { ref } from "vue";

/**
 * Module-level toast list. `Toaster.vue` renders it from the app root, so
 * callers anywhere (including non-component modules such as engine health)
 * can raise one. Titles and labels are i18n keys; the toaster translates them,
 * since this module has no component context.
 */

export interface ToastAction {
  /** i18n key for the button label. */
  labelKey: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  titleKey: string;
  descriptionKey?: string;
  variant?: "default" | "danger";
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. */
  duration: number;
  actions?: ToastAction[];
}

const toasts = ref<Toast[]>([]);

export function useToasts() {
  return toasts;
}

/** Adds a toast. A repeated id replaces the previous one in place. */
export function pushToast(toast: Omit<Toast, "id"> & { id?: string }): string {
  const id = toast.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  toasts.value = [...toasts.value.filter((entry) => entry.id !== id), { ...toast, id }];

  return id;
}

export function dismissToast(id: string): void {
  toasts.value = toasts.value.filter((entry) => entry.id !== id);
}
