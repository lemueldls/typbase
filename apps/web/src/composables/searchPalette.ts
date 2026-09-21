/**
 * Search palette visibility. The palette renders once in the app shell; the
 * keyboard shortcut and the search buttons in the sidebar and page toolbar
 * all open it through this shared state.
 */
export const useSearchPalette = createSharedComposable(() => {
  const open = ref(false);

  function show(): void {
    open.value = true;
  }

  function hide(): void {
    open.value = false;
  }

  function toggle(): void {
    open.value = !open.value;
  }

  return { open, show, hide, toggle };
});
