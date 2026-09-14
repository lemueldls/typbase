<script setup lang="ts">
import type { TextRef } from "@typbase/codemirror";
import type { FileId, SvgRangedFrame, TypstState } from "@typbase/wasm";

const props = defineProps<{
  fileId: FileId;
  spaceId: string;
  text: TextRef;
  prelude: TextRef;
  typstState: TypstState;
  /** Bumped when workspace data changes; pages using queries re-render. */
  dataRevision: number;
  /** Bumped when rendering state changed (e.g. system fonts installed). */
  renderRevision: number;
  onRequests?: (requests: unknown[], spaceId: string) => Promise<boolean> | boolean;
  /** Fired when a compile call trapped; the parent rebuilds the wasm state. */
  onPanic?: () => void;
}>();

const emit = defineEmits<{
  (e: "panic"): void;
  (e: "navigate", pageId: string): void;
}>();

// App-internal links (typbase://page/<id>) open the page in the editor;
// external links leave the app, so confirm first and open in a new tab.
function onPreviewClick(event: MouseEvent) {
  const target = event.target as Element | null;
  const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor) return;

  const href = anchor.getAttribute("href") ?? "";
  if (href.startsWith("typbase://page/")) {
    event.preventDefault();
    const pageId = href.slice("typbase://page/".length);
    if (pageId) emit("navigate", pageId);
    return;
  }

  if (/^(https?|mailto):/.test(href)) {
    event.preventDefault();
    if (window.confirm(`Open external link?\n\n${href}\n\nIt opens in a new tab.`)) {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }
}

const scroller = useTemplateRef("scroller");
const frames = ref<SvgRangedFrame[]>([]);
const rendering = ref(false);

const renderNow = async () => {
  if (!props.typstState || !scroller.value || scroller.value.offsetParent === null) return;

  rendering.value = true;
  try {
    let result;
    try {
      result = props.typstState.compilePaged(props.fileId, props.text.value, props.prelude.value);
    } catch (error) {
      console.error("[typst] paged compile panicked:", error);
      emit("panic");

      return;
    }

    if (result.requests.length > 0 && props.onRequests) {
      const updated = await props.onRequests(result.requests, props.spaceId);
      if (updated) {
        scheduleRender();
        return;
      }
    }

    frames.value = result.frames;
  } finally {
    rendering.value = false;
  }
};

const scheduleRender = useDebounceFn(renderNow, 160);

let resizeObserver: ResizeObserver | undefined;

watch(
  () => props.typstState,
  () => scheduleRender(),
);

function measureWidth(): number {
  const scrollerEl = scroller.value;
  if (!scrollerEl) return 0;

  const inner = scrollerEl.querySelector<HTMLElement>(".paged-preview__inner");
  if (!inner) return scrollerEl.clientWidth;

  const style = getComputedStyle(inner);

  return inner.clientWidth - (parseFloat(style.paddingLeft) + parseFloat(style.paddingRight));
}

function frameStyle(frame: SvgRangedFrame): Record<string, string> {
  const match = frame.render.svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const width = match ? Number(match[1]) : frame.render.width;
  const height = match ? Number(match[2]) : frame.render.height;

  return { "--frame-w": `${width}px`, "--frame-h": `${height}px` };
}

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    const width = measureWidth();
    if (width > 0) {
      props.typstState.resize(props.fileId, width);
      scheduleRender();
    }
  });
  if (scroller.value) resizeObserver.observe(scroller.value);
  scroller.value?.addEventListener("click", onPreviewClick);

  scheduleRender();
});

onBeforeUnmount(() => {
  scroller.value?.removeEventListener("click", onPreviewClick);
  resizeObserver?.disconnect();
});

watch(
  () => props.text.value,
  () => scheduleRender(),
);
watch(
  () => props.dataRevision,
  () => scheduleRender(),
);
watch(
  () => props.renderRevision,
  () => scheduleRender(),
);

/** Frame geometry measured from the DOM. Keeps scroll sync honest. */
interface FrameLayout {
  /** Cumulative top offsets in px. */
  tops: number[];
  topsEnd: number;
  /** Source ranges (UTF-16) per frame. */
  ranges: Array<{ start: number; end: number }>;
}

function getFrameLayout(): FrameLayout {
  const els = scroller.value?.querySelectorAll<HTMLElement>("[data-frame]") ?? [];
  const tops: number[] = [];
  const ranges: Array<{ start: number; end: number }> = [];

  for (const [index, el] of Array.from(els).entries()) {
    tops.push(el.offsetTop);
    const frame = frames.value[index];
    ranges.push(frame ? { start: frame.range.start, end: frame.range.end } : { start: 0, end: 0 });
  }

  return { tops, topsEnd: tops.at(-1) ?? 0, ranges };
}

defineExpose({ scroller, getFrameLayout });
</script>

<template>
  <div ref="scroller" class="paged-preview">
    <div v-if="rendering" class="paged-preview__status">rendering...</div>
    <div class="paged-preview__inner">
      <div
        v-for="(frame, index) in frames"
        :key="index"
        data-frame
        class="paged-preview__frame"
        :style="frameStyle(frame)"
      >
        <!-- eslint-disable-next-line vue/no-v-html -- the wasm engine produced this SVG markup -->
        <div v-html="frame.render.svg" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.paged-preview {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-surface);
}

.paged-preview :deep(a[href]) {
  cursor: pointer;
}

.paged-preview__status {
  position: sticky;
  top: 0.5rem;
  z-index: 1;
  margin: 0.5rem;
  padding: 0.2rem 0.6rem;
  width: fit-content;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  background: color-mix(in srgb, var(--color-surface) 88%, transparent);
  border: 1px solid var(--color-border);
  border-radius: 999px;
}

.paged-preview__inner {
  padding: 1rem 1.25rem 3rem;
}

@media (max-width: 768px) {
  .paged-preview__inner {
    padding: 0.75rem 0.75rem 2rem;
  }
}

.paged-preview__frame {
  display: block;
  /* Clip a render that is wider than the pane (mid-resize) instead of
     stretching it or growing a horizontal scrollbar. */
  overflow: hidden;
}

.paged-preview__frame :deep(svg) {
  display: block;
  width: var(--frame-w) !important;
  height: var(--frame-h) !important;
}
</style>
