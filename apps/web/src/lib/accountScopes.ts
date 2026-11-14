import type { MaterialSymbol } from "material-symbols";

import { OAUTH_SCOPES } from "@typbase/typing";

/** One plain-language permission group. The raw scopes stay under "Technical details". */
export interface AccountScopeGroup {
  id: string;
  icon: MaterialSymbol;
  titleKey: string;
  bodyKey: string;
  scopes: readonly string[];
}

export const ACCOUNT_SCOPE_GROUPS: readonly AccountScopeGroup[] = [
  {
    id: "identity",
    icon: "badge",
    titleKey: "account.scopeIdentity",
    bodyKey: "account.scopeIdentityBody",
    scopes: ["atproto"],
  },
  {
    id: "sync",
    icon: "sync",
    titleKey: "account.scopeSync",
    bodyKey: "account.scopeSyncBody",
    scopes: [
      "blob:*/*",
      "space:at.typbase.workspace?authority=*&action=read",
      "space:at.typbase.workspace?authority=*&collection=*",
      "space:at.typbase.workspace?authority=*&manage=create&manage=update",
    ],
  },
  {
    id: "pages",
    icon: "description",
    titleKey: "account.scopePages",
    bodyKey: "account.scopePagesBody",
    scopes: ["repo:at.typbase.post"],
  },
  {
    id: "site",
    icon: "public",
    titleKey: "account.scopeSite",
    bodyKey: "account.scopeSiteBody",
    scopes: [
      "repo:place.wisp.fs",
      "repo:place.wisp.settings",
      "repo:place.wisp.subfs",
      "repo:site.standard.publication",
      "repo:site.standard.document",
      "rpc:place.wisp.v2.domain.claimSubdomain?aud=*",
      "rpc:place.wisp.v2.domain.claim?aud=*",
      "rpc:place.wisp.v2.domain.addSite?aud=*",
      "rpc:place.wisp.v2.domain.delete?aud=*",
      "rpc:place.wisp.v2.domain.getList?aud=*",
      "rpc:place.wisp.v2.site.delete?aud=*",
    ],
  },
  {
    id: "extensions",
    icon: "extension",
    titleKey: "account.scopeExtensions",
    bodyKey: "account.scopeExtensionsBody",
    scopes: [
      "repo:at.typbase.plugin",
      "repo:at.typbase.pluginRelease",
      "repo:at.typbase.theme",
      "repo:at.typbase.themeRelease",
    ],
  },
  {
    id: "install",
    icon: "monitoring",
    titleKey: "account.scopeInstall",
    bodyKey: "account.scopeInstallBody",
    scopes: ["repo:at.typbase.install"],
  },
];

/** Every raw scope the groups above account for. Used by the coverage test. */
export function groupedAccountScopes(): string[] {
  return ACCOUNT_SCOPE_GROUPS.flatMap((group) => [...group.scopes]);
}

/** Scopes that `OAUTH_SCOPES` adds but no group explains. Should stay empty. */
export function uncoveredAccountScopes(): string[] {
  const grouped = new Set(groupedAccountScopes());

  return OAUTH_SCOPES.filter((scope) => !grouped.has(scope));
}

/** Grouped scopes that the client no longer requests. Should stay empty. */
export function staleAccountScopes(): string[] {
  const requested = new Set(OAUTH_SCOPES);

  return groupedAccountScopes().filter((scope) => !requested.has(scope));
}
