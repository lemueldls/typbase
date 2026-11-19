<script setup lang="ts">
import { APP_NAME, formatDocumentTitle } from "~/lib/documentTitle";

const config = useRuntimeConfig();
const pageUrl = `${String(config.public.appUrl).replace(/\/+$/, "")}/privacy`;
const title = formatDocumentTitle("Privacy", APP_NAME);
const description =
  "Typbase keeps your workspace on your device. This page lists what can leave it and who can read it.";

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
  ogType: "website",
  ogUrl: pageUrl,
});

useHead({ link: [{ rel: "canonical", href: pageUrl }] });
</script>

<template>
  <main class="privacy">
    <header class="privacy__topbar">
      <NuxtLink to="/" class="privacy__brand">
        <MsIcon name="arrow_back" :size="16" />
        Typbase
      </NuxtLink>
    </header>

    <article class="privacy__page">
      <h1>{{ $t("privacy.title") }}</h1>
      <p class="privacy__lead">{{ $t("privacy.intro") }}</p>

      <AccountDataLabel />

      <footer class="privacy__footer">
        <a
          href="https://github.com/lemueldls/typbase/issues"
          target="_blank"
          rel="noopener noreferrer"
          >{{ $t("privacy.issues") }}</a
        >
        <span class="privacy__footer-sep" aria-hidden="true">·</span>
        <a href="https://github.com/lemueldls/typbase" target="_blank" rel="noopener noreferrer">{{
          $t("privacy.source")
        }}</a>
      </footer>
    </article>
  </main>
</template>

<style>
.privacy {
  max-width: 680px;
  margin: 0 auto;
  padding: calc(var(--space-4) + var(--safe-top)) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-12) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
}

.privacy__topbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
}

.privacy__brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  font-weight: 500;
  text-decoration: none;
}

.privacy__page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.privacy__page h1 {
  margin: 0;
  font-size: var(--text-3xl);
  font-weight: 600;
  color: var(--color-text);
}

.privacy__lead {
  margin: 0;
  font-size: var(--text-md);
  line-height: var(--leading-normal);
  color: var(--color-text-secondary);
}

.privacy__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
  font-size: var(--text-sm);
}

.privacy__footer a {
  color: var(--color-text-secondary);
  text-decoration: none;
}

.privacy__footer a:hover {
  color: var(--color-accent);
  text-decoration: underline;
}

.privacy__footer-sep {
  color: var(--color-text-tertiary);
}
</style>
