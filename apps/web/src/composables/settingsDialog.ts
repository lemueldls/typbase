import { ref } from "vue";

/** Settings tab ids. Each one maps to a panel in `SettingsDialog`. */
export type SettingsTab =
  | "general"
  | "appearance"
  | "editor"
  | "content"
  | "ai"
  | "sync"
  | "export";

const open = ref(false);
const tab = ref<SettingsTab>("general");

export function useSettingsDialog() {
  return {
    open,
    tab,
    /** Open settings, optionally on a specific tab. */
    show(nextTab?: SettingsTab): void {
      if (nextTab) tab.value = nextTab;
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
