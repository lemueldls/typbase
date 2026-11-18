import { openExternal } from "~/lib/openExternal";

/**
 * Asks before leaving the app and resolves whether the link opened. Rendered
 * frame links, paged previews, and plugin actions all go through this so the
 * confirmation stays one modal instead of `window.confirm`.
 */
export function useExternalLink(): (url: string) => Promise<boolean> {
  const { confirm } = useConfirm();
  const { t } = useI18n();

  return async (url: string) => {
    const confirmed = await confirm({
      title: t("externalLink.title"),
      description: url,
      confirmLabel: t("common.open"),
      danger: false,
    });

    if (confirmed) openExternal(url);
    return confirmed;
  };
}
