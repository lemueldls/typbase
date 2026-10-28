import type { SiteSettings } from "@typbase/typing";

/**
 * Drops the account-owned parts of a site before another publisher takes over.
 * Pages, design, and the Wisp endpoint stay. The previous deployment, domain
 * claim, and Standard.site record keys do not: they live in the old account's
 * repo and cannot be reused by the new one. The old site is left untouched.
 */
export function forkSiteSettings(site: SiteSettings, siteRkey: string): SiteSettings {
  return {
    ...site,
    wisp: {
      ...site.wisp,
      siteRkey,
      subdomain: "",
      customDomain: "",
      domainStatus: "none",
      domainError: "",
      domainDns: null,
      publisherDid: null,
      lastDeploy: null,
      fileHashes: {},
    },
    standard: {
      ...site.standard,
      publicationRkey: null,
      publicationUri: null,
      documentRkeys: {},
    },
  };
}
