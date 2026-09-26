<script setup lang="ts">
import type { PostValue } from "@typbase/spaces";

import { createPublicPostsClient } from "@typbase/spaces";

import { APP_NAME, formatDocumentTitle } from "~/lib/documentTitle";

const routeDid = useRouteParams<string>("did");

const loading = ref(true);
const error = ref("");
const author = ref<{ did: string; handle: string | null }>({
  did: "",
  handle: null,
});
const posts = ref<
  Array<{
    uri: string;
    value: PostValue;
    html: string;
  }>
>([]);

watchImmediate(routeDid, async (input) => {
  if (!input) {
    error.value = "Missing DID";
    loading.value = false;

    return;
  }

  try {
    // Read-only airspace over one account's public posts; identity resolution
    // (handle -> DID -> PDS) happens inside.
    const client = createPublicPostsClient(input);
    const identity = await client.identity();
    author.value = { did: identity.did, handle: identity.handle ?? null };

    const records = await Promise.all(
      (await client.post.list()).map(async (record) => {
        const url = await client.blobs.url(record.value.html);
        if (!url) return null;

        const response = await fetch(url);
        if (!response.ok) return null;

        return { uri: record.uri, value: record.value, html: await response.text() };
      }),
    );

    // Post keys are page ids, not TIDs, so order by the record's timestamps.
    posts.value = records
      .filter((record) => record !== null)
      .sort((a, b) =>
        String(b.value.updatedAt ?? b.value.createdAt ?? "").localeCompare(
          String(a.value.updatedAt ?? a.value.createdAt ?? ""),
        ),
      );
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
});

function formatDate(value: unknown): string {
  const parsed = new Date(String(value ?? ""));

  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString();
}

function tagList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

const { t } = useI18n();

/** Author name once identity resolves; the DID is the fallback. */
const profileName = computed(() => author.value.handle ?? author.value.did);

/** Public profile title: "Author · Typbase". */
const profileTitle = computed(() => formatDocumentTitle(profileName.value, APP_NAME));

const profileDescription = computed(() =>
  profileName.value ? t("profile.description", { name: profileName.value }) : undefined,
);

useSeoMeta({
  title: () => profileTitle.value,
  ogTitle: () => profileTitle.value,
  twitterTitle: () => profileTitle.value,
  ogType: "profile",
  description: () => profileDescription.value,
  ogDescription: () => profileDescription.value,
});

definePageMeta({ ssr: false });
</script>

<template>
  <main class="profile">
    <header class="profile__header">
      <h1>{{ author.handle ?? author.did }}</h1>
      <p class="profile__sub">{{ author.did }}</p>
      <p v-if="posts.length" class="profile__count">
        {{ $t("profile.publishedCount", { count: posts.length }) }}
      </p>
    </header>

    <p v-if="loading" class="profile__status">Loading...</p>
    <p v-else-if="error" class="profile__error">{{ error }}</p>
    <p v-else-if="posts.length === 0" class="profile__status">
      {{ $t("profile.nothing") }}
    </p>

    <section v-else class="profile__posts">
      <article v-for="post in posts" :key="post.uri" class="profile__post">
        <div class="profile__post-head">
          <h2>{{ post.value.title }}</h2>
          <div class="profile__meta">
            <span v-if="post.value.updatedAt">{{
              $t("profile.updated", { date: formatDate(post.value.updatedAt) })
            }}</span>
            <a
              v-if="post.value.sourceUri"
              class="profile__link"
              :href="String(post.value.sourceUri)"
              rel="noopener"
            >
              {{ $t("profile.viewSource") }}
            </a>
          </div>
        </div>
        <div v-if="post.value.summary" class="profile__summary">
          {{ post.value.summary }}
        </div>
        <div class="profile__tags">
          <span v-for="tag in tagList(post.value.tags)" :key="tag" class="profile__tag">
            #{{ tag }}
          </span>
        </div>
        <iframe
          class="profile__frame"
          :srcdoc="post.html"
          sandbox="allow-same-origin allow-scripts"
          loading="lazy"
        />
      </article>
    </section>
  </main>
</template>

<style>
.profile {
  max-width: 760px;
  margin: 0 auto;
  padding: calc(var(--space-8) + var(--safe-top)) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-16) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
}

.profile__header h1 {
  margin: 0;
  font-size: var(--text-3xl);
}

.profile__sub {
  margin: var(--space-0-5) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.profile__count {
  color: var(--color-text-secondary);
  font-size: var(--text-md);
}

.profile__status {
  color: var(--color-text-secondary);
}

.profile__error {
  color: var(--color-danger);
}

.profile__posts {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  margin-top: var(--space-6);
}

.profile__post {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  background: var(--color-surface);
}

.profile__post-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-4);
}

.profile__post-head h2 {
  margin: 0;
  font-size: var(--text-xl);
}

.profile__meta {
  display: flex;
  gap: var(--space-3);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.profile__link {
  color: var(--color-accent);
}

.profile__summary {
  margin: var(--space-1-5) 0;
  color: var(--color-text-secondary);
  font-size: var(--text-md);
}

.profile__tags {
  display: flex;
  gap: var(--space-1-5);
  flex-wrap: wrap;
  margin-bottom: var(--space-2-5);
}

.profile__tag {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.profile__frame {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: #fff;
  min-height: 300px;
}
</style>
