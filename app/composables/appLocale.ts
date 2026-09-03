import type { WorkspaceStore } from "@typbase/storage";

import { formatAgo, formatDate } from "~/lib/format";

/**
 * App locale bridge. The workspace setting `settings.locale` drives the i18n
 * locale ("auto" = browser language, which @nuxtjs/i18n already detected),
 * and every date/time renders through Intl with the resolved locale. Called
 * once per open store (Settings + boot); re-applies on setting changes.
 */
const SUPPORTED = ["en", "es", "de", "fr", "zh"] as const;
type AppLocaleCode = (typeof SUPPORTED)[number];

export function effectiveLocale(settings: { locale?: string }): AppLocaleCode {
  const code = settings.locale ?? "auto";
  if (code !== "auto" && (SUPPORTED as readonly string[]).includes(code)) {
    return code as AppLocaleCode;
  }
  // i18n detected the browser locale at startup; keep whatever it picked.
  const detected =
    typeof navigator !== "undefined" ? (navigator.language.split("-")[0] ?? "en") : "en";
  return (SUPPORTED as readonly string[]).includes(detected) ? (detected as AppLocaleCode) : "en";
}

export function useAppLocale(store?: WorkspaceStore | null) {
  const { locale, setLocale } = useI18n();

  function apply(settings: { locale?: string } | undefined): void {
    const code = effectiveLocale(settings ?? {});
    if (locale.value !== code) void setLocale(code);
  }

  if (store) {
    apply(store.getSettings());
    store.onStructureChange(() => apply(store.getSettings()));
  } else {
    apply({});
  }

  function set(value: string): void {
    if (store) {
      store.updateSettings({ locale: value });
    } else if (value === "auto") {
      const detected =
        typeof navigator !== "undefined" ? (navigator.language.split("-")[0] ?? "en") : "en";
      void setLocale(
        (SUPPORTED as readonly string[]).includes(detected) ? (detected as AppLocaleCode) : "en",
      );
    } else {
      void setLocale(value as AppLocaleCode);
    }
  }

  const code = computed(() => locale.value);

  return {
    /** Current i18n locale code (e.g. "en"), for Intl formats. */
    code,
    /** Locale-aware formatters wired to the active code. */
    formatDate: (value: Parameters<typeof formatDate>[0], options: Intl.DateTimeFormatOptions) =>
      formatDate(value, options, code.value),
    formatAgo: (timestamp: number) => formatAgo(timestamp, code.value),
    set,
  };
}
