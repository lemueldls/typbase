const open = ref(false);

export function useSettingsDialog() {
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
