<script setup lang="ts">
import { Client } from "@atproto/lex-client";
import { createIdResolver, resolveIdentifier, resolvePds } from "@typbase/spaces";

import { fetchPublishedPosts } from "~/lib/publish";

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
    cid: string | null;
    value: Record<string, unknown>;
    html: string;
    blobCid: string;
  }>
>([]);

const resolver = createIdResolver();

function blobCidOf(refValue: unknown): string | null {
  if (!refValue) return null;

  if (typeof refValue === "string") return refValue;

  if (typeof refValue === "object") {
    const ref = (refValue as { ref?: unknown }).ref;

    return typeof ref === "string" ? ref : null;
  }

  return null;
}

watchImmediate(routeDid, async (input) => {
  if (!input) {
    error.value = "Missing DID";
    loading.value = false;

    return;
  }

  try {
    const did = await resolveIdentifier(input, resolver);
    const doc = await resolver.did.resolve(did);
    author.value = {
      did,
      handle:
        doc?.alsoKnownAs?.find((value) => value.startsWith("at://"))?.slice("at://".length) ?? null,
    };
    const pdsUrl = await resolvePds(did, resolver, {
      getPdsUrl: () => undefined,
      setPdsUrl: () => {},
    });

    const records = await fetchPublishedPosts(did, pdsUrl);
    const byNewest = [...records].sort((a, b) => {
      const aTime = String(a.value.updatedAt ?? a.value.createdAt ?? "").localeCompare(
        String(b.value.updatedAt ?? b.value.createdAt ?? ""),
      );

      return -aTime;
    });

    const withHtml = await Promise.all(
      byNewest.slice(0, 50).map(async (record) => {
        const cid = blobCidOf(record.value.html);
        if (!cid) return null;

        const response = await fetch(
          `${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`,
        );
        if (!response.ok) return null;

        const html = await response.text();

        return { ...record, html, blobCid: cid };
      }),
    );
    posts.value = withHtml.filter((post) => post !== null);
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

<style scoped>
.profile {
  max-width: 760px;
  margin: 0 auto;
  padding: 2rem 1rem 4rem;
}

.profile__header h1 {
  margin: 0;
  font-size: 1.6rem;
}

.profile__sub {
  margin: 0.15rem 0 0;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}

.profile__count {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
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
  gap: 1.5rem;
  margin-top: 1.5rem;
}

.profile__post {
  border: 1px solid var(--color-border);
  border-radius: 0.6rem;
  padding: 1rem;
  background: var(--color-surface);
}

.profile__post-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
}

.profile__post-head h2 {
  margin: 0;
  font-size: 1.15rem;
}

.profile__meta {
  display: flex;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.profile__link {
  color: var(--color-accent);
}

.profile__summary {
  margin: 0.4rem 0;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.profile__tags {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-bottom: 0.6rem;
}

.profile__tag {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.profile__frame {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 0.4rem;
  background: #fff;
  min-height: 300px;
}
</style>
