import { ref } from "vue";

export interface ToastAction {
  /** i18n key for the button label. */
  labelKey: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  /** i18n key for the title; `title` wins when both are set. */
  titleKey?: string;
  /** Raw text used instead of `titleKey` when set (plugin messages). */
  title?: string;
  descriptionKey?: string;
  /** Interpolation values for the i18n keys. */
  params?: Record<string, unknown>;
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
