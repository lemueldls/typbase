/**
 * The keyboard shortcuts dialog's open state. It is app-wide because the help
 * chord, the app bar menu, and the global dialog all need the same state.
 */
const open = ref(false);

export function useShortcutsDialog() {
  return {
    open,
    show(): void {
      open.value = true;
    },
    hide(): void {
      open.value = false;
    },
    toggle(): void {
      open.value = !open.value;
    },
  };
}
