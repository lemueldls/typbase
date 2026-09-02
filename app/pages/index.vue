<script setup lang="ts">
import PageView, { type ViewMode } from "~/components/workspace/PageView.vue";
import SearchPalette from "~/components/workspace/SearchPalette.vue";
import Sidebar from "~/components/workspace/Sidebar.vue";
import WorkspaceSwitcher from "~/components/workspace/WorkspaceSwitcher.vue";
import { useSearch } from "~/composables/search";
import { useTypst } from "~/composables/typst";
import { useWorkspace } from "~/composables/workspace";
import { refreshSections, toSections } from "~/lib/ai/generators";

const { workspace, error, ensure, dataRevision, bootProgress, bootNote, workspaceGeneration } =
  useWorkspace();

const loaded = ref(false);
const currentPageId = ref<string>("");
const mode = ref<ViewMode>("write");
const paletteOpen = ref(false);

const { ensure: ensureSearch } = useSearch();

// Cmd-K / Ctrl-K opens the search palette.
onKeyStroke((event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    paletteOpen.value = !paletteOpen.value;
  }
});

// Search snapshots links: the palette needs the index started.
watch(
  paletteOpen,
  async (open) => {
    if (open && workspace.value) {
      const instance = await ensureSearch(workspace.value);
      void instance;
    }
  },
  { immediate: true },
);

// Switching workspaces swaps the store under the shell; the generation key
// remounts Sidebar/PageView, so the page id must be re-selected first. The
// watcher runs pre-render in the same tick as the bump.
watch(workspaceGeneration, () => {
  const store = workspace.value;
  if (!store) {
    currentPageId.value = "";
    return;
  }
  const settings = store.getSettings();
  currentPageId.value = settings.homePageId ?? store.listPages()[0]?.id ?? "";
});

// Section metadata should stay fresh even without the editor being open:
// the store's page changes drive a re-extract on every page switch.
watch(currentPageId, async (id) => {
  if (!id || !workspace.value) return;

  const store = workspace.value;
  const text = await store.loadPageText(id);
  const typstState = await useTypst().catch(() => null);
  if (!typstState) return;

  await refreshSections(store, id, text, (source) =>
    toSections(typstState.extractSections(source)),
  );
});

onMounted(async () => {
  await ensure();
  loaded.value = true;

  const store = workspace.value!;
  const settings = store.getSettings();

  // Open the home page when there is one, else the first page.
  if (settings.homePageId) {
    currentPageId.value = settings.homePageId;
  } else {
    currentPageId.value = store.listPages()[0]?.id ?? "";
  }
});

// Keep the URL shareable-ish: ?page=<id>&mode=<mode>.
const route = useRoute();
const router = useRouter();

watch(currentPageId, (id) => {
  if (loaded.value && id) {
    void router.replace({
      query: { ...route.query, page: id, mode: mode.value },
    });
  }
});

watch(mode, (value) => {
  if (loaded.value && currentPageId.value) {
    void router.replace({
      query: { ...route.query, page: currentPageId.value, mode: value },
    });
  }
});

function openPage(id: string) {
  if (id) currentPageId.value = id;
  else {
    // Deleted the open page; fall back to home/first page.
    const store = workspace.value;
    if (!store) return;

    const settings = store.getSettings();
    currentPageId.value = settings.homePageId ?? store.listPages()[0]?.id ?? "";
  }
}

// Persist pending snapshot writes when the tab goes away.
useEventListener("pagehide", () => {
  void workspace.value?.flush();
});

async function setMode(value: ViewMode) {
  mode.value = value;
}

definePageMeta({ ssr: false });
</script>

<template>
  <main class="app">
    <div v-if="!loaded" class="app__loading">
      <h2 class="app__loading-title">Opening workspace</h2>

      <ul class="boot-steps">
        <li
          v-for="step in bootProgress"
          :key="step.id"
          class="boot-step"
          :class="`boot-step--${step.status}`"
        >
          <span class="boot-step__marker" aria-hidden="true">
            <span v-if="step.status === 'active'" class="boot-step__spinner" />
            <template v-else-if="step.status === 'done'">✓</template>
            <template v-else-if="step.status === 'error'">!</template>
            <template v-else>·</template>
          </span>
          <span class="boot-step__label">{{ step.label }}</span>
          <span v-if="step.detail" class="boot-step__detail">{{ step.detail }}</span>
        </li>
      </ul>

      <p v-if="bootNote" class="app__note">{{ bootNote }}</p>
      <p v-if="error" class="app__error">{{ error }}</p>
    </div>

    <template v-else-if="workspace">
      <div :key="workspaceGeneration" class="app__content">
        <Sidebar :store="workspace" :current-page-id="currentPageId" @select="openPage" />

        <div class="app__main">
          <PageView
            v-if="currentPageId"
            :key="currentPageId"
            :page-id="currentPageId"
            :model-value="mode"
            @update:model-value="setMode"
            @open-page="openPage"
          />
          <div v-else class="app__empty">
            <p>No pages yet.</p>
            <p class="app__empty-hint">Create one from the sidebar.</p>
          </div>
        </div>

        <SearchPalette
          v-if="paletteOpen && workspace"
          :store="workspace"
          @close="paletteOpen = false"
        />
      </div>
    </template>

    <div v-else class="app__chooser">
      <WorkspaceSwitcher mode="screen" />
    </div>
  </main>
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.app__content {
  display: contents;
}

.app__chooser {
  flex: 1;
  display: grid;
  place-content: center;
}

.app__loading,
.app__empty {
  flex: 1;
  display: grid;
  place-content: center;
  gap: 0.5rem;
  color: var(--text-secondary);
  text-align: center;
}

.app__loading {
  align-content: center;
}

.app__loading-title {
  margin: 0 0 0.75rem;
  font-size: 1.05rem;
  color: var(--text);
}

.app__error {
  color: var(--danger);
}

.app__note {
  max-width: 26rem;
  margin: 0.5rem auto 0;
  font-size: 0.8rem;
}

.boot-steps {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  text-align: left;
  min-width: 18rem;
}

.boot-step {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.boot-step--active {
  color: var(--text);
}

.boot-step--done {
  color: var(--ok);
}

.boot-step--error {
  color: var(--danger);
}

.boot-step__marker {
  width: 1.1rem;
  text-align: center;
  font-weight: 600;
  flex: none;
}

.boot-step__label {
  flex: none;
}

.boot-step__detail {
  font-size: 0.78rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.boot-step__spinner {
  display: inline-block;
  width: 0.8em;
  height: 0.8em;
  border: 2px solid var(--text-secondary);
  border-top-color: transparent;
  border-radius: 50%;
  animation: boot-spin 0.8s linear infinite;
  vertical-align: -1px;
}

@keyframes boot-spin {
  to {
    transform: rotate(360deg);
  }
}

.app__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
}

.app__empty {
  color: var(--text-secondary);
}

.app__empty-hint {
  margin: 0;
}
</style>
