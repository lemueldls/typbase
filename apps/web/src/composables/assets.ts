import { watch } from "vue";

/**
 * Runs a callback after asset sync stores new bytes locally. The revision is
 * part of AtprotoStatus, so the watcher stops with the component and no DOM
 * event or global listener is involved.
 */
export function useAssetDownloads(callback: () => void | Promise<void>): void {
  const { atprotoStatus } = useWorkspace();

  watch(
    () => atprotoStatus.value.assets.revision,
    () => {
      void callback();
    },
  );
}
