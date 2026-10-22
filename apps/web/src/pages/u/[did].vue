<script setup lang="ts">
import type { PostValue } from "@typbase/spaces";

import { createPublicPostsClient } from "@typbase/spaces";

import type { PublicProfile } from "~/lib/actor";

import { fetchPublicProfile } from "~/lib/actor";
import { APP_NAME, formatDocumentTitle } from "~/lib/documentTitle";
import { openExternal } from "~/lib/openExternal";

const routeDid = useRouteParams<string>("did");

const loading = ref(true);
const error = ref("");
const author = ref<PublicProfile>({
  did: "",
  handle: null,
  displayName: null,
  description: null,
  avatar: null,
  banner: null,
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
    // The posts client resolves handle -> DID -> PDS. The AppView profile is
    // optional and adds the display name, avatar, and bio when the account has
    // one; the PDS identity still supplies the canonical DID and handle.
    const client = createPublicPostsClient(input);
    const [identity, rich] = await Promise.all([client.identity(), fetchPublicProfile(input)]);
    author.value = {
      did: identity.did,
      handle: rich?.handle ?? identity.handle ?? null,
      displayName: rich?.displayName ?? null,
      description: rich?.description ?? null,
      avatar: rich?.avatar ?? null,
      banner: rich?.banner ?? null,
    };

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

/** Display name, then handle, then DID as the identity fallback. */
const profileName = computed(
  () => author.value.displayName || author.value.handle || author.value.did,
);

/** Public profile title: "Author · Typbase". */
const profileTitle = computed(() => formatDocumentTitle(profileName.value, APP_NAME));

const profileDescription = computed(
  () =>
    author.value.description ||
    (profileName.value ? t("profile.description", { name: profileName.value }) : undefined),
);

const blueskyUrl = computed(() =>
  author.value.handle || author.value.did
    ? `https://bsky.app/profile/${author.value.handle ?? author.value.did}`
    : "",
);

useSeoMeta({
  title: () => profileTitle.value,
  ogTitle: () => profileTitle.value,
  ogType: "profile",
  description: () => profileDescription.value,
  ogDescription: () => profileDescription.value,
});

definePageMeta({ ssr: false });
</script>

<template>
  <main class="profile">
    <header class="profile__topbar">
      <NuxtLink to="/" class="profile__brand">
        <MsIcon name="arrow_back" :size="16" />
        Typbase
      </NuxtLink>
    </header>

    <header class="profile__card">
      <img v-if="author.banner" class="profile__banner" :src="author.banner" alt="" />
      <div class="profile__body">
        <img v-if="author.avatar" class="profile__avatar" :src="author.avatar" alt="" />
        <MsIcon
          v-else
          class="profile__avatar profile__avatar--placeholder"
          name="account_circle"
          :size="88"
        />
        <div class="profile__identity">
          <h1>{{ profileName }}</h1>
          <p v-if="author.handle" class="profile__handle">@{{ author.handle }}</p>
          <p class="profile__sub">{{ author.did }}</p>
          <p v-if="author.description" class="profile__bio">{{ author.description }}</p>
          <div class="profile__actions">
            <!-- <a
              v-if="blueskyUrl"
              class="profile__link"
              :href="blueskyUrl"
              rel="noopener noreferrer"
              @click.prevent="openExternal(blueskyUrl)"
            >
              {{ $t("profile.viewBluesky") }}
            </a> -->
            <span v-if="posts.length" class="profile__count">
              {{ $t("profile.publishedCount", { count: posts.length }, posts.length) }}
            </span>
          </div>
        </div>
      </div>
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
  max-width: 780px;
  margin: 0 auto;
  padding: calc(var(--space-4) + var(--safe-top)) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-12) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
}

.profile__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.profile__brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  font-weight: 600;
  text-decoration: none;
  font-weight: 500;
}

.profile__open:hover {
  text-decoration: underline;
}

.profile__card {
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.profile__banner {
  display: block;
  width: 100%;
  height: 132px;
  object-fit: cover;
  background: var(--color-surface-2);
}

.profile__body {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-5);
}

.profile__avatar {
  flex: none;
  width: 88px;
  height: 88px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--color-surface-2);
}

.profile__avatar--placeholder {
  color: var(--color-text-secondary);
}

.profile__identity {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.profile__identity h1 {
  margin: 0;
  font-size: var(--text-3xl);
  font-weight: 600;
  letter-spacing: -0.02em;
}

.profile__handle {
  margin: 0;
  color: var(--color-accent);
  font-size: var(--text-md);
}

.profile__sub {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}

.profile__bio {
  max-width: 42rem;
  margin: var(--space-1) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--text-md);
  line-height: var(--leading-normal);
  white-space: pre-wrap;
}

.profile__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-1);
}

.profile__link {
  color: var(--color-accent);
  font-size: var(--text-sm);
  text-decoration: none;
}

.profile__link:hover {
  text-decoration: underline;
}

.profile__count {
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.profile__status {
  margin: var(--space-6) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--text-md);
  text-align: center;
}

.profile__error {
  margin: var(--space-6) 0 0;
  color: var(--color-danger);
  text-align: center;
}

.profile__posts {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-top: var(--space-5);
}

.profile__post {
  padding: var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.profile__post-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-4);
}

.profile__post-head h2 {
  font-size: var(--text-xl);
  font-weight: 600;
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

@media (max-width: 48rem) {
  .profile {
    padding-top: calc(var(--space-3) + var(--safe-top));
  }

  .profile__banner {
    height: 104px;
  }

  .profile__body {
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .profile__avatar {
    width: 64px;
    height: 64px;
  }

  .profile__identity h1 {
    font-size: var(--text-2xl);
  }
}

.profile__frame {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: #fff;
  min-height: 300px;
}
</style>
