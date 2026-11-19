<script setup lang="ts">
import { APP_NAME, formatDocumentTitle } from "~/lib/documentTitle";

const config = useRuntimeConfig();
const pageUrl = `${String(config.public.appUrl).replace(/\/+$/, "")}/privacy`;
const title = formatDocumentTitle("Privacy", APP_NAME);
const description =
  "What Typbase stores on your device, what it sends when you sign in, sync, publish, or use a plugin, and what it never collects.";

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
        <p>
          {{ $t("privacy.contact") }}
          <a
            href="https://github.com/lemueldls/typbase/issues"
            target="_blank"
            rel="noopener noreferrer"
            >GitHub</a
          >.
        </p>
        <p>
          {{ $t("privacy.source") }}
          <a
            href="https://github.com/lemueldls/typbase"
            target="_blank"
            rel="noopener noreferrer"
            >{{ $t("privacy.sourceLink") }}</a
          >.
        </p>
      </footer>
    </article>
  </main>
</template>

<style>
.privacy {
  max-width: 780px;
  margin: 0 auto;
  padding: calc(var(--space-4) + var(--safe-top)) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-12) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
}

.privacy__topbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-6);
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
  gap: var(--space-5);
}

.privacy__page h1 {
  margin: 0;
  font-size: var(--text-3xl);
  font-weight: 600;
  color: var(--color-text);
}

.privacy__lead,
.privacy__footer p {
  margin: 0;
  font-size: var(--text-md);
  line-height: var(--leading-normal);
  color: var(--color-text-secondary);
}

.privacy__footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
}

.privacy__footer a {
  color: var(--color-accent);
}
</style>
