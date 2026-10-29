<script setup lang="ts">
import type { SiteSettings } from "@typbase/typing";

import type { SiteBuildNavigationGroup } from "~/lib/site/build";

import { PROJECT_URL } from "~/lib/projectLinks";
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, ogLocale } from "~/lib/site/social";
import { absoluteUrl, relativeUrl } from "~/lib/site/urls";

export interface SiteTocEntry {
  id: string;
  text: string;
  level: number;
}

const props = defineProps<{
  site: SiteSettings;
  lang: string;
  name: string;
  title: string;
  description: string;
  url: string;
  baseUrl: string;
  root: string;
  body: string;
  headCss: string;
  navigation: SiteBuildNavigationGroup[];
  toc: SiteTocEntry[];
  currentPageId: string;
  workspaceIcon: string;
  createdAt?: number;
  updatedAt?: number;
  ogImage?: string;
  ogImageAlt?: string;
  ogType?: "article" | "website";
  noindex?: boolean;
}>();

const layout = computed(() => props.site.layout ?? "docs");
const docs = computed(() => layout.value === "docs");
const sidebar = computed(
  () => docs.value || props.site.navigation === "sidebar" || props.site.navigation === "both",
);
const top = computed(
  () => !docs.value && (props.site.navigation === "top" || props.site.navigation === "both"),
);
const showFooter = computed(() => props.site.showFooter !== false);
const showFooterName = computed(() => props.site.showFooterName !== false);
const rail = computed(
  () => docs.value && (props.site.showGraph || props.site.showToc || showFooter.value),
);
const documentTitle = computed(() =>
  props.title === props.name ? props.name : `${props.title} · ${props.name}`,
);
const canonical = computed(() => (props.baseUrl ? absoluteUrl(props.baseUrl, props.url) : ""));
const feedUrl = computed(() => (props.baseUrl ? absoluteUrl(props.baseUrl, "/feed.xml") : ""));
const topPages = computed(() =>
  props.navigation
    .flatMap((group) => group.pages)
    .filter((page) => page.id !== props.currentPageId)
    .slice(0, 8),
);
const updated = computed(() =>
  props.updatedAt ? new Date(props.updatedAt).toISOString().slice(0, 10) : "",
);
const publishedIso = computed(() =>
  props.createdAt ? new Date(props.createdAt).toISOString() : "",
);
const updatedIso = computed(() => (props.updatedAt ? new Date(props.updatedAt).toISOString() : ""));
const imageAlt = computed(() => props.ogImageAlt || `${props.title} · ${props.name}`);
const imageWidth = String(OG_IMAGE_WIDTH);
const imageHeight = String(OG_IMAGE_HEIGHT);
const locale = computed(() => ogLocale(props.lang));
</script>

<template>
  <html :lang="lang" :data-layout="layout">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta v-if="noindex" name="robots" content="noindex, nofollow" />
      <title>{{ documentTitle }}</title>
      <meta v-if="description" name="description" :content="description" />
      <link v-if="canonical" rel="canonical" :href="canonical" />
      <meta property="og:type" :content="ogType || 'article'" />
      <meta property="og:title" :content="title" />
      <meta v-if="description" property="og:description" :content="description" />
      <meta v-if="canonical" property="og:url" :content="canonical" />
      <meta property="og:site_name" :content="name" />
      <meta property="og:locale" :content="locale" />
      <meta v-if="ogImage" property="og:image" :content="ogImage" />
      <meta v-if="ogImage" property="og:image:type" content="image/png" />
      <meta v-if="ogImage" property="og:image:width" :content="imageWidth" />
      <meta v-if="ogImage" property="og:image:height" :content="imageHeight" />
      <meta v-if="ogImage" property="og:image:alt" :content="imageAlt" />
      <meta v-if="publishedIso" property="article:published_time" :content="publishedIso" />
      <meta v-if="updatedIso" property="article:modified_time" :content="updatedIso" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" :content="title" />
      <meta v-if="description" name="twitter:description" :content="description" />
      <meta v-if="ogImage" name="twitter:image" :content="ogImage" />
      <meta v-if="ogImage" name="twitter:image:alt" :content="imageAlt" />
      <meta name="generator" content="Typbase" />
      <link rel="stylesheet" :href="`${root}assets/site.css`" />
      <link
        v-if="baseUrl && site.includeFeed"
        rel="alternate"
        type="application/rss+xml"
        :href="feedUrl"
        :title="name"
      />
      <component :is="'style'" v-if="headCss" v-html="headCss"></component>
      <meta name="typbase-standard-publication" content="" />
      <meta name="typbase-standard-document" content="" />
    </head>

    <body
      :data-root="root"
      :data-search="site.showSearch ? `${root}search.json` : undefined"
      :data-graph="site.showGraph ? `${root}graph.json` : undefined"
      :data-page-url="url"
      :data-nav="site.navigation"
      :data-layout="layout"
    >
      <a class="site-skip" href="#site-content">Skip to content</a>

      <header class="site-header">
        <button
          v-if="sidebar"
          class="site-menu-toggle"
          type="button"
          data-site-menu
          aria-label="Toggle navigation"
          aria-controls="site-sidebar"
          aria-expanded="false"
        >
          <span
            v-if="site.showIcons"
            class="site-icon material-symbols-rounded"
            data-site-menu-icon
            aria-hidden="true"
          >
            menu
          </span>
          <span class="site-menu-bar"></span>
          <span class="site-menu-bar"></span>
          <span class="site-menu-bar"></span>
        </button>

        <a class="site-brand" :href="root" :title="name">
          <span
            v-if="site.showIcons"
            class="site-icon material-symbols-rounded site-brand__icon"
            aria-hidden="true"
          >
            {{ workspaceIcon }}
          </span>
          <span class="site-brand__text">{{ name }}</span>
        </a>

        <nav v-if="top" class="site-top">
          <a v-for="page in topPages" :key="page.id" :href="relativeUrl(root, page.url)">
            {{ page.title }}
          </a>
        </nav>

        <div
          v-if="!docs && site.showSearch"
          class="site-search"
          :class="{ 'site-search--icons': site.showIcons }"
        >
          <span
            v-if="site.showIcons"
            class="site-icon material-symbols-rounded site-search__icon"
            aria-hidden="true"
          >
            search
          </span>
          <input
            id="site-search"
            type="search"
            placeholder="Search"
            aria-label="Search this site"
          />
          <div class="site-search__results" hidden></div>
        </div>

        <button
          v-if="site.showGraph"
          class="site-graph-toggle"
          type="button"
          data-site-graph
          aria-label="Page graph"
          aria-controls="site-graph-panel"
          title="Page graph"
        >
          <span v-if="site.showIcons" class="site-icon material-symbols-rounded" aria-hidden="true">
            hub
          </span>
          <svg
            :class="{ 'site-graph-toggle__fallback': site.showIcons }"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle cx="6" cy="6" r="2.2" />
            <circle cx="18" cy="8" r="2.2" />
            <circle cx="10" cy="18" r="2.2" />
            <path d="M8.1 6.6 15.9 7.4M7.4 8.1 9.4 15.7M16.9 9.9 11.8 16.5" />
          </svg>
          <span class="site-graph-toggle__label">Graph</span>
        </button>
      </header>

      <div
        class="site-layout"
        :class="{
          'site-layout--docs': docs,
          'site-layout--no-rail': docs && !rail,
        }"
      >
        <aside v-if="sidebar" id="site-sidebar" class="site-sidebar">
          <div v-if="docs" class="site-sidebar__head">
            <a class="site-brand" :href="root" :title="name">
              <span
                v-if="site.showIcons"
                class="site-icon material-symbols-rounded site-brand__icon"
                aria-hidden="true"
              >
                {{ workspaceIcon }}
              </span>
              <span class="site-brand__text">{{ name }}</span>
            </a>
            <div
              v-if="site.showSearch"
              class="site-search"
              :class="{ 'site-search--icons': site.showIcons }"
            >
              <span
                v-if="site.showIcons"
                class="site-icon material-symbols-rounded site-search__icon"
                aria-hidden="true"
              >
                search
              </span>
              <input
                id="site-search"
                type="search"
                placeholder="Search"
                aria-label="Search this site"
              />
              <div class="site-search__results" hidden></div>
            </div>
          </div>

          <nav class="site-nav">
            <section
              v-for="group in navigation"
              :key="group.id ?? group.name"
              class="site-nav__group"
            >
              <p class="site-sidebar__title">{{ group.name }}</p>
              <ul>
                <li v-for="page in group.pages" :key="page.id">
                  <a
                    :class="{ 'is-current': page.id === currentPageId }"
                    :href="relativeUrl(root, page.url)"
                    :aria-current="page.id === currentPageId ? 'page' : undefined"
                    :title="page.title"
                  >
                    {{ page.title }}
                  </a>
                </li>
              </ul>
            </section>
          </nav>

          <nav v-if="!docs && site.showToc && toc.length" class="site-toc">
            <p class="site-sidebar__title">On this page</p>
            <ol>
              <li v-for="entry in toc" :key="entry.id" :class="`site-toc__${entry.level}`">
                <a :href="`#${entry.id}`">{{ entry.text }}</a>
              </li>
            </ol>
          </nav>
        </aside>

        <main id="site-content" class="site-content">
          <article
            class="site-page"
            :class="{ 'site-page--preserve-newlines': site.preserveNewlines }"
            v-html="body"
          ></article>
          <p v-if="site.showDates && updated" class="site-updated">Updated {{ updated }}</p>
          <footer v-if="!docs && showFooter" class="site-footer">
            <span v-if="showFooterName" class="site-footer__name" :title="name">{{ name }}</span>
            <a :href="PROJECT_URL" target="_blank" rel="noopener noreferrer"> Made with Typbase </a>
          </footer>
          <footer v-if="docs && showFooter" class="site-footer site-footer--mobile">
            <span v-if="showFooterName" class="site-footer__name" :title="name">{{ name }}</span>
            <a :href="PROJECT_URL" target="_blank" rel="noopener noreferrer"> Made with Typbase </a>
          </footer>
        </main>

        <aside v-if="rail" class="site-rail">
          <section v-if="site.showGraph" class="site-rail__section">
            <p class="site-rail__title">Interactive graph</p>
            <button
              class="site-rail__graph-preview"
              type="button"
              data-site-graph
              aria-label="Open page graph"
              aria-controls="site-graph-panel"
              title="Open page graph"
            >
              <span class="site-rail__graph-frame">
                <canvas data-site-graph-preview aria-hidden="true"></canvas>
              </span>
              <span>Open interactive graph</span>
            </button>
          </section>

          <nav v-if="site.showToc && toc.length" class="site-toc">
            <p class="site-sidebar__title">On this page</p>
            <ol>
              <li v-for="entry in toc" :key="entry.id" :class="`site-toc__${entry.level}`">
                <a :href="`#${entry.id}`">{{ entry.text }}</a>
              </li>
            </ol>
          </nav>

          <footer v-if="showFooter" class="site-footer">
            <span v-if="showFooterName" class="site-footer__name" :title="name">{{ name }}</span>
            <a :href="PROJECT_URL" target="_blank" rel="noopener noreferrer"> Made with Typbase </a>
          </footer>
        </aside>
      </div>

      <div
        v-if="site.showGraph"
        id="site-graph-panel"
        class="site-graph"
        data-site-graph-panel
        hidden
      >
        <div class="site-graph__bar">
          <span>Page graph</span>
          <button
            class="site-graph__close"
            type="button"
            data-site-graph-close
            aria-label="Close graph"
          >
            <span
              v-if="site.showIcons"
              class="site-icon material-symbols-rounded"
              aria-hidden="true"
            >
              close
            </span>
            <span v-if="site.showIcons" class="site-graph__fallback">×</span>
            <template v-if="!site.showIcons">×</template>
          </button>
        </div>
        <canvas class="site-graph__canvas" data-site-graph-canvas></canvas>
        <p class="site-graph__hint">Drag to pan. Scroll to zoom. Click a page to open it.</p>
      </div>

      <component :is="'script'" :src="`${root}assets/site.js`" defer></component>
      <component
        :is="'script'"
        v-if="site.showGraph"
        :src="`${root}assets/site-graph.js`"
        defer
      ></component>
    </body>
  </html>
</template>
