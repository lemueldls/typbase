/**
 * The "What Typbase writes" label, shared by the account dialog.
 *
 * Only structure and translation keys live here. The copy is in the locale
 * files so the label and the rest of the account surface stay translated.
 */
export type DataLabelVisibility = "device" | "workspace" | "public" | "third-party";

export interface DataLabelEntry {
  id: string;
  titleKey: string;
  bodyKey: string;
  visibility: DataLabelVisibility;
  /** Records written, when the entry writes any. */
  collections?: readonly string[];
  removalKey: string;
  /** A host action the dialog can run. */
  action?: "delete-install";
}

export interface DataLabelGroup {
  id: DataLabelVisibility;
  titleKey: string;
  introKey: string;
  entries: readonly DataLabelEntry[];
}

export const DATA_LABEL_GROUPS: readonly DataLabelGroup[] = [
  {
    id: "device",
    titleKey: "dataLabel.groups.device.title",
    introKey: "dataLabel.groups.device.intro",
    entries: [
      {
        id: "tokens",
        titleKey: "dataLabel.entries.tokens.title",
        bodyKey: "dataLabel.entries.tokens.body",
        visibility: "device",
        removalKey: "dataLabel.entries.tokens.removal",
      },
      {
        id: "ai-keys",
        titleKey: "dataLabel.entries.aiKeys.title",
        bodyKey: "dataLabel.entries.aiKeys.body",
        visibility: "device",
        removalKey: "dataLabel.entries.aiKeys.removal",
      },
      {
        id: "settings",
        titleKey: "dataLabel.entries.settings.title",
        bodyKey: "dataLabel.entries.settings.body",
        visibility: "device",
        removalKey: "dataLabel.entries.settings.removal",
      },
      {
        id: "local-workspace",
        titleKey: "dataLabel.entries.localWorkspace.title",
        bodyKey: "dataLabel.entries.localWorkspace.body",
        visibility: "device",
        removalKey: "dataLabel.entries.localWorkspace.removal",
      },
    ],
  },
  {
    id: "workspace",
    titleKey: "dataLabel.groups.workspace.title",
    introKey: "dataLabel.groups.workspace.intro",
    entries: [
      {
        id: "workspace-changes",
        titleKey: "dataLabel.entries.workspaceChanges.title",
        bodyKey: "dataLabel.entries.workspaceChanges.body",
        visibility: "workspace",
        collections: ["at.typbase.update", "at.typbase.snapshot"],
        removalKey: "dataLabel.entries.workspaceChanges.removal",
      },
      {
        id: "page-drafts",
        titleKey: "dataLabel.entries.pageDrafts.title",
        bodyKey: "dataLabel.entries.pageDrafts.body",
        visibility: "workspace",
        collections: ["at.typbase.post"],
        removalKey: "dataLabel.entries.pageDrafts.removal",
      },
      {
        id: "media",
        titleKey: "dataLabel.entries.media.title",
        bodyKey: "dataLabel.entries.media.body",
        visibility: "workspace",
        collections: ["at.typbase.asset"],
        removalKey: "dataLabel.entries.media.removal",
      },
    ],
  },
  {
    id: "public",
    titleKey: "dataLabel.groups.public.title",
    introKey: "dataLabel.groups.public.intro",
    entries: [
      {
        id: "published-pages",
        titleKey: "dataLabel.entries.publishedPages.title",
        bodyKey: "dataLabel.entries.publishedPages.body",
        visibility: "public",
        collections: ["at.typbase.post"],
        removalKey: "dataLabel.entries.publishedPages.removal",
      },
      {
        id: "published-site",
        titleKey: "dataLabel.entries.publishedSite.title",
        bodyKey: "dataLabel.entries.publishedSite.body",
        visibility: "public",
        collections: ["place.wisp.fs", "place.wisp.settings", "place.wisp.subfs"],
        removalKey: "dataLabel.entries.publishedSite.removal",
      },
      {
        id: "site-discovery",
        titleKey: "dataLabel.entries.siteDiscovery.title",
        bodyKey: "dataLabel.entries.siteDiscovery.body",
        visibility: "public",
        collections: ["site.standard.publication", "site.standard.document"],
        removalKey: "dataLabel.entries.siteDiscovery.removal",
      },
      {
        id: "plugin-listings",
        titleKey: "dataLabel.entries.pluginListings.title",
        bodyKey: "dataLabel.entries.pluginListings.body",
        visibility: "public",
        collections: ["at.typbase.plugin", "at.typbase.pluginRelease"],
        removalKey: "dataLabel.entries.pluginListings.removal",
      },
      {
        id: "theme-listings",
        titleKey: "dataLabel.entries.themeListings.title",
        bodyKey: "dataLabel.entries.themeListings.body",
        visibility: "public",
        collections: ["at.typbase.theme", "at.typbase.themeRelease"],
        removalKey: "dataLabel.entries.themeListings.removal",
      },
      {
        id: "install-record",
        titleKey: "dataLabel.entries.installRecord.title",
        bodyKey: "dataLabel.entries.installRecord.body",
        visibility: "public",
        collections: ["at.typbase.install"],
        removalKey: "dataLabel.entries.installRecord.removal",
        action: "delete-install",
      },
    ],
  },
  {
    id: "third-party",
    titleKey: "dataLabel.groups.thirdParty.title",
    introKey: "dataLabel.groups.thirdParty.intro",
    entries: [
      {
        id: "ai-providers",
        titleKey: "dataLabel.entries.aiProviders.title",
        bodyKey: "dataLabel.entries.aiProviders.body",
        visibility: "third-party",
        removalKey: "dataLabel.entries.aiProviders.removal",
      },
      {
        id: "font-requests",
        titleKey: "dataLabel.entries.fontRequests.title",
        bodyKey: "dataLabel.entries.fontRequests.body",
        visibility: "third-party",
        removalKey: "dataLabel.entries.fontRequests.removal",
      },
      {
        id: "typst-packages",
        titleKey: "dataLabel.entries.typstPackages.title",
        bodyKey: "dataLabel.entries.typstPackages.body",
        visibility: "third-party",
        removalKey: "dataLabel.entries.typstPackages.removal",
      },
      {
        id: "account-services",
        titleKey: "dataLabel.entries.accountServices.title",
        bodyKey: "dataLabel.entries.accountServices.body",
        visibility: "third-party",
        removalKey: "dataLabel.entries.accountServices.removal",
      },
    ],
  },
];

export const NOT_COLLECTED_KEYS: readonly string[] = [
  "dataLabel.notCollected.analytics",
  "dataLabel.notCollected.deviceId",
  "dataLabel.notCollected.contact",
  "dataLabel.notCollected.workspace",
  "dataLabel.notCollected.ads",
];

export function collectionsInLabel(): string[] {
  return DATA_LABEL_GROUPS.flatMap((group) =>
    group.entries.flatMap((entry) => [...(entry.collections ?? [])]),
  );
}
