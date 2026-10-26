/**
 * A site is a public projection of a workspace. The workspace stays the
 * editable source; these settings say which pages leave it, how they are laid
 * out, and where the built files are hosted.
 */

/** Whether a page is built into the site. */
export type SiteVisibility = "public" | "unlisted" | "private";

/** How the generated pages are styled. */
export type SiteTheme = "light" | "workspace";

/** Navigation placement in the generated shell. */
export type SiteNavigation = "sidebar" | "top" | "both" | "none";

export interface SitePageSettings {
  /**
   * Public pages appear in navigation, search, feeds, and the sitemap.
   * Unlisted pages are built and reachable but stay out of all of those.
   * Private pages are not built at all.
   */
  visibility?: SiteVisibility;
  /** Path segment override. Without one the page path supplies the URL. */
  slug?: string;
  /** Title override for the website and Standard.site records. */
  title?: string;
  description?: string;
  tags?: string[];
  hiddenFromNav?: boolean;
  includeInSearch?: boolean;
  includeInFeed?: boolean;
}

export interface SiteDeployState {
  url: string;
  wispUri: string;
  manifestCid: string | null;
  deployedAt: number;
  buildHash: string;
  pageCount: number;
  fileCount: number;
  totalBytes: number;
  standardPublicationUri: string | null;
}

export interface SiteWispSettings {
  /** Hosting service, defaulting to the public Wisp instance. */
  serviceUrl: string;
  /** Service DID used for the domain XRPC audience. */
  serviceDid: string;
  /** Record key of the `place.wisp.fs` record. */
  siteRkey: string;
  /** Claimed `<label>.wisp.place` subdomain, when there is one. */
  subdomain: string;
  /** Custom domain, when there is one. */
  customDomain: string;
  domainStatus: "none" | "pending" | "verified" | "error";
  domainError: string;
  /** DNS records Wisp returned for a pending custom domain. */
  domainDns: { txtName: string; txtValue: string; cnameTarget: string } | null;
  /** Account that owns the records. Only that account may deploy. */
  publisherDid: string | null;
  lastDeploy: SiteDeployState | null;
}

export interface SiteStandardSettings {
  /** Write `site.standard.publication` and `site.standard.document` records. */
  enabled: boolean;
  /** Stable TID of the publication record. */
  publicationRkey: string | null;
  publicationUri: string | null;
  /** Page id to document rkey. Kept so updates reuse the same records. */
  documentRkeys: Record<string, string>;
  /** Whether the publication may appear in Standard.site discovery feeds. */
  showInDiscover: boolean;
}

export interface SiteSettings {
  /** Display name. Empty follows the workspace name. */
  name: string;
  description: string;
  /** URL-safe site name, also the Wisp site rkey. */
  slug: string;
  /** Page shown at `/`. Empty follows the workspace home page. */
  homePageId: string | null;
  theme: SiteTheme;
  /** Visibility for pages without an explicit override. */
  defaultVisibility: SiteVisibility;
  pages: Record<string, SitePageSettings>;
  navigation: SiteNavigation;
  showSearch: boolean;
  showToc: boolean;
  showDates: boolean;
  /**
   * Keep the editor's line spacing between source lines. The synth renders
   * each top-level line as its own block; the site CSS otherwise leaves those
   * divs tight.
   */
  preserveNewlines: boolean;
  /** Write sitemap.xml and robots.txt. */
  includeSitemap: boolean;
  /** Write feed.xml. */
  includeFeed: boolean;
  wisp: SiteWispSettings;
  standard: SiteStandardSettings;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  name: "",
  description: "",
  slug: "",
  homePageId: null,
  theme: "workspace",
  defaultVisibility: "private",
  pages: {},
  navigation: "sidebar",
  showSearch: true,
  showToc: true,
  showDates: true,
  preserveNewlines: false,
  includeSitemap: true,
  includeFeed: true,
  wisp: {
    serviceUrl: "https://wisp.place",
    serviceDid: "did:web:wisp.place",
    siteRkey: "",
    subdomain: "",
    customDomain: "",
    domainStatus: "none",
    domainError: "",
    domainDns: null,
    publisherDid: null,
    lastDeploy: null,
  },
  standard: {
    enabled: true,
    publicationRkey: null,
    publicationUri: null,
    documentRkeys: {},
    showInDiscover: true,
  },
};
