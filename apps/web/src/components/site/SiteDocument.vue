<script setup lang="ts">
import type { SiteSettings } from "@typbase/typing";

import type { SiteBuildNavigationGroup } from "~/lib/site/build";

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
  updatedAt?: number;
  noindex?: boolean;
}>();

const sidebar = computed(
  () => props.site.navigation === "sidebar" || props.site.navigation === "both",
);
const top = computed(() => props.site.navigation === "top" || props.site.navigation === "both");
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
</script>

<template>
  <html :lang="lang">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta v-if="noindex" name="robots" content="noindex, nofollow" />
      <title>{{ documentTitle }}</title>
      <meta v-if="description" name="description" :content="description" />
      <link v-if="canonical" rel="canonical" :href="canonical" />
      <meta property="og:type" content="article" />
      <meta property="og:title" :content="title" />
      <meta v-if="description" property="og:description" :content="description" />
      <meta v-if="canonical" property="og:url" :content="canonical" />
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
      :data-nav="site.navigation"
    >
      <a class="site-skip" href="#site-content">Skip to content</a>

      <header class="site-header">
        <button
          class="site-menu-toggle"
          type="button"
          data-site-menu
          aria-label="Toggle navigation"
        >
          <span></span><span></span><span></span>
        </button>
        <a class="site-brand" :href="root">{{ name }}</a>

        <nav v-if="top" class="site-top">
          <a v-for="page in topPages" :key="page.id" :href="relativeUrl(root, page.url)">
            {{ page.title }}
          </a>
        </nav>

        <div v-if="site.showSearch" class="site-search">
          <input
            id="site-search"
            type="search"
            placeholder="Search"
            aria-label="Search this site"
          />
          <div class="site-search__results" hidden></div>
        </div>
      </header>

      <div class="site-layout">
        <aside v-if="sidebar" class="site-sidebar">
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
                  >
                    {{ page.title }}
                  </a>
                </li>
              </ul>
            </section>
          </nav>

          <nav v-if="site.showToc && toc.length" class="site-toc">
            <p class="site-sidebar__title">On this page</p>
            <ol>
              <li v-for="entry in toc" :key="entry.id" :class="`site-toc__${entry.level}`">
                <a :href="`#${entry.id}`">{{ entry.text }}</a>
              </li>
            </ol>
          </nav>
        </aside>

        <main id="site-content" class="site-content">
          <article class="site-page" v-html="body"></article>
          <p v-if="site.showDates && updated" class="site-updated">Updated {{ updated }}</p>
          <footer class="site-footer">
            <span>{{ name }}</span>
            <span>Made with Typbase</span>
          </footer>
        </main>
      </div>

      <component :is="'script'" :src="`${root}assets/site.js`" defer></component>
    </body>
  </html>
</template>
