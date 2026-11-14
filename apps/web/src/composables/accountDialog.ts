export const ACCOUNT_VIEWS = ["signin", "create", "permissions", "accounts", "data"] as const;

export type AccountView = (typeof ACCOUNT_VIEWS)[number];

const open = ref(false);
const view = ref<AccountView>("signin");

/**
 * One account dialog for the whole app. The shell mounts it once, and the app
 * bar, sidebar, settings, and publishing surfaces call `show()`.
 */
export function useAccountDialog() {
  function show(next: AccountView = "signin"): void {
    view.value = next;
    open.value = true;
  }

  function hide(): void {
    open.value = false;
  }

  return {
    open,
    view,
    show,
    hide,
  };
}
