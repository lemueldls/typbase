<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import {
  createProviderFor,
  generateExplain,
  generateFlashcards,
  generateOutline,
  generateQuiz,
  generateSimplify,
  generateSummary,
  generateStudyGuide,
  type GenerationContext,
} from "~/lib/ai/generators";
import { refreshSections, toSections } from "~/lib/ai/generators";
import { getAiKeys } from "~/lib/ai/keys";
import { engineAvailable } from "~/lib/engineHealth";

const props = defineProps<{
  pageId: string;
  store: WorkspaceStore;
  /** Current selection in the editor, when there is one. */
  getSelection: () => { from: number; to: number; text: string } | null;
  /** Inserts generated Typst below the cursor/selection. */
  insertBelowSelection: (from: number, to: number, text: string) => void;
}>();

const { t } = useI18n();
const busy = ref(false);
const error = ref("");

const aiEnabled = computed(() => props.store.getAiConfig().enabled);
const menuOpen = ref(false);

// AI features are opt-in: the first click on the menu offers to enable them,
// then opens the picker. Nothing is generated or sent before that.
async function onTrigger() {
  if (busy.value) return;
  if (!aiEnabled.value) {
    if (!window.confirm(t("aiMenu.enableConfirm"))) {
      return;
    }

    props.store.updateSettings({
      ai: { ...props.store.getAiConfig(), enabled: true },
    });
  }
  menuOpen.value = !menuOpen.value;
}

// Section extraction runs in wasm; the first call loads the instance. Resolve
// the state per call: a recovery swaps the singleton, and a cached closure
// would keep talking to the dead one.
async function extractSections(source: string) {
  if (!engineAvailable()) return null;

  const typstState = await useTypst();

  return toSections(typstState.extractSections(source), source);
}

async function context(): Promise<GenerationContext> {
  const selection = props.getSelection();

  return {
    store: props.store,
    provider: createProviderFor(props.store, getAiKeys()),
    pageId: props.pageId,
    pageText: await props.store.loadPageText(props.pageId),
    selection: selection?.text,
  };
}

async function scoped(
  scope: "selection" | "page",
  run: (ctx: GenerationContext) => Promise<string>,
) {
  if (busy.value) return;

  const selection = props.getSelection();
  if (scope === "selection" && !selection) return;

  busy.value = true;
  error.value = "";
  try {
    const ctx = await context();
    const output = await run(ctx);
    props.insertBelowSelection(
      selection?.from ?? ctx.pageText.length,
      selection?.to ?? ctx.pageText.length,
      output,
    );
    await refreshSections(
      props.store,
      props.pageId,
      await props.store.loadPageText(props.pageId),
      extractSections,
    );
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function flashcardsForCategory() {
  if (busy.value) return;

  const page = props.store.getPage(props.pageId);
  const category = page?.categoryId
    ? props.store.listCategories().find((cat) => cat.id === page.categoryId)
    : undefined;
  if (!category) {
    error.value = "This page has no category. Set one from the sidebar first.";
    return;
  }

  busy.value = true;
  error.value = "";
  try {
    const categoryPages = props.store
      .listPages()
      .filter((candidate) => candidate.categoryId === category.id);
    const texts = await Promise.all(
      categoryPages.map(async (candidate) => ({
        title: candidate.title,
        text: await props.store.loadPageText(candidate.id),
      })),
    );
    const ctx: GenerationContext = {
      store: props.store,
      provider: createProviderFor(props.store, getAiKeys()),
      pageId: props.pageId,
      pageText: texts.map((entry) => entry.text).join("\n\n"),
    };
    let deck = await generateFlashcards(ctx);
    if (!deck.startsWith("#typbase.section")) {
      deck = `#typbase.section(kind: "flashcards")[\n${deck}\n]`;
    }

    const slug = category.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const newPage = await props.store.createPage({
      title: `Flashcards: ${category.name}`,
      path: `pages/flashcards-${slug}.typ`,
      categoryId: category.id,
      content: `= Flashcards: ${category.name}\n\n${deck}\n`,
    });
    await refreshSections(
      props.store,
      newPage.id,
      await props.store.loadPageText(newPage.id),
      extractSections,
    );
    emit("openPage", newPage.id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function studyGuideForCategory() {
  if (busy.value) return;

  const page = props.store.getPage(props.pageId);
  const category = page?.categoryId
    ? props.store.listCategories().find((cat) => cat.id === page.categoryId)
    : undefined;
  if (!category) {
    error.value = "This page has no category. Set one from the sidebar first.";
    return;
  }

  busy.value = true;
  error.value = "";
  try {
    const categoryPages = props.store
      .listPages()
      .filter((candidate) => candidate.categoryId === category.id);
    const texts = await Promise.all(
      categoryPages.map(async (candidate) => ({
        title: candidate.title,
        text: await props.store.loadPageText(candidate.id),
      })),
    );
    const guide = await generateStudyGuide(
      createProviderFor(props.store, getAiKeys()),
      category.name,
      texts,
    );

    const slug = category.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const newPage = await props.store.createPage({
      title: `Study guide: ${category.name}`,
      path: `pages/study-guide-${slug}.typ`,
      categoryId: category.id,
      content: guide,
    });
    await refreshSections(
      props.store,
      newPage.id,
      await props.store.loadPageText(newPage.id),
      extractSections,
    );
    emit("openPage", newPage.id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function quizForPage() {
  const selection = props.getSelection();
  await scoped(selection ? "selection" : "page", generateQuiz);
}

const emit = defineEmits<{ (e: "openPage", id: string): void }>();
</script>

<template>
  <PopoverRoot v-model:open="menuOpen">
    <PopoverTrigger as-child>
      <UiTooltip :text="$t('aiMenu.title')">
        <UiButton
          size="small"
          :class="{ 'button--muted': !aiEnabled }"
          :disabled="busy"
          @click="onTrigger"
        >
          <MsIcon name="psychology" :size="16" />
          {{ busy ? $t("common.working") : aiEnabled ? "AI" : $t("aiMenu.off") }}
        </UiButton>
      </UiTooltip>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="menu ai-menu" :side-offset="6" align="end">
        <button
          type="button"
          class="menu__item"
          @click="scoped('page', (ctx) => generateSummary(ctx, 'page'))"
        >
          {{ $t("aiMenu.summarize") }}
        </button>
        <button
          type="button"
          class="menu__item"
          @click="scoped('page', (ctx) => generateOutline(ctx, 'page'))"
        >
          {{ $t("aiMenu.outline") }}
        </button>
        <button
          type="button"
          class="menu__item"
          :disabled="!getSelection()"
          @click="scoped('selection', generateExplain)"
        >
          {{ $t("aiMenu.explain") }}
        </button>
        <button
          type="button"
          class="menu__item"
          :disabled="!getSelection()"
          @click="scoped('selection', generateSimplify)"
        >
          {{ $t("aiMenu.simplify") }}
        </button>

        <div class="menu__separator" />

        <button type="button" class="menu__item" @click="quizForPage">
          {{ $t("aiMenu.quiz") }}
        </button>
        <button type="button" class="menu__item" @click="flashcardsForCategory">
          {{ $t("aiMenu.flashcards") }}
        </button>
        <button type="button" class="menu__item" @click="studyGuideForCategory">
          {{ $t("aiMenu.studyGuide") }}
        </button>

        <p v-if="error" class="ai-menu__error" role="alert">{{ error }}</p>
        <p class="ai-menu__hint">
          {{ $t("aiMenu.hint") }}
        </p>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style scoped>
.ai-menu {
  min-width: 13rem;
}

.button--muted {
  opacity: 0.7;
}

.ai-menu__error {
  margin: var(--space-2) 0 0;
  padding: 0 var(--space-2-5);
  font-size: var(--text-xs);
  color: var(--color-danger);
}

.ai-menu__hint {
  margin: var(--space-2) 0 0;
  padding: var(--space-2) var(--space-2-5) var(--space-1);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}
</style>
