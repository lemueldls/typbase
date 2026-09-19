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
  (e: "navigatePlugin", instanceId: string): void;
  (e: "jump", range: { from: number; to: number }): void;
}>();

/** The link under the pointer, if any.
 *
 * The SVG draws a link's hit box as a transparent rect in its own `<a>`
 * group, separate from the glyphs, so a click on the text has no anchor
 * ancestor. Fall back to testing each anchor's box by position. */
function linkAt(event: MouseEvent, frameEl: HTMLElement | null): string | null {
  const direct = (event.target as Element | null)?.closest?.("a[href]");
  if (direct) return direct.getAttribute("href") ?? "";

  for (const anchor of frameEl?.querySelectorAll<SVGAElement>("a[href]") ?? []) {
    const rect = anchor.getBoundingClientRect();
    if (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    ) {
      return anchor.getAttribute("href") ?? "";
    }
  }

  return null;
}

// App-internal links (typbase://page/<id>, typbase://plugin/<id>) stay in the
// app; external links leave it, so confirm first and open in a new tab.
// Alt-click skips activation and jumps into the link source instead, so it can
// be edited. Everything else in a frame is click-to-jump: the click maps back
// into the compiled document and the parent reveals that source position.
function onPreviewClick(event: MouseEvent) {
  const target = event.target as Element | null;
  const frameEl = target?.closest?.("[data-frame]") as HTMLElement | null;

  const href = linkAt(event, frameEl);
  if (href !== null && !event.altKey) {
    if (href.startsWith("typbase://page/")) {
      event.preventDefault();
      const pageId = href.slice("typbase://page/".length);
      if (pageId) emit("navigate", pageId);
      return;
    }

    if (href.startsWith("typbase://plugin/")) {
      event.preventDefault();
      const instanceId = href.slice("typbase://plugin/".length);
      if (instanceId) emit("navigatePlugin", instanceId);
      return;
    }

    if (/^(https?|mailto):/.test(href)) {
      event.preventDefault();
      if (window.confirm(`Open external link?\n\n${href}\n\nIt opens in a new tab.`)) {
        window.open(href, "_blank", "noopener,noreferrer");
      }
    }

    return;
  }

  // Alt-click on a link falls through to here; stop the SVG anchor from
  // following the href before jumping.
  if (href !== null) event.preventDefault();

  const frame = frameEl ? frames.value[Number(frameEl.dataset.frame)] : undefined;
  if (!frame) return;

  // Measure the SVG, not the clipping frame: a frame laid out for a wider
  // pane overflows and is clipped, and its rendered size is the viewBox size.
  const svg = frameEl!.querySelector("svg") ?? frameEl!;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const x = (event.clientX - rect.left) * (frame.render.width / rect.width);
  const y = frame.render.yOffset + (event.clientY - rect.top) * (frame.render.height / rect.height);

  const jump = props.typstState.jumpPaged(props.fileId, x, y);
  if (jump) emit("jump", { from: jump.position, to: jump.position });
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

watch(
  () => props.typstState,
  () => scheduleRender(),
);

/** Platform scrollbars vary; erring low keeps frames inside the pane. */
const SCROLLBAR_ALLOWANCE = 12;

function measureWidth(): number {
  const scrollerEl = scroller.value;
  if (!scrollerEl) return 0;

  const inner = scrollerEl.querySelector<HTMLElement>(".paged-preview__inner");
  const style = getComputedStyle(inner ?? scrollerEl);

  // The scroller's border box includes any scrollbar and does not depend on
  // the rendered frames, so a reflow cannot change this width and set off
  // another compile. Content-box measurements crept as the scrollbar toggled.
  return Math.max(
    0,
    scrollerEl.getBoundingClientRect().width -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight) -
      SCROLLBAR_ALLOWANCE,
  );
}

useResizeObserver(scroller, () => {
  const width = measureWidth();
  if (width <= 0) return;

  // resize() reports whether the width actually changed. Height-only
  // observer ticks must not schedule another compile, or the pane keeps
  // reflowing after it has settled.
  if (props.typstState.resize(props.fileId, width)) scheduleRender();
});

onMounted(() => {
  scheduleRender();
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

/** Editor line height in px. The editor scroller uses 1.4 with a 1rem font. */
function editorLineHeight(): number {
  if (typeof document === "undefined") return 22.4;

  const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize || "16");

  return rootSize * 1.4;
}

/** UTF-16 offsets where each source line starts. */
function lineStarts(text: string): number[] {
  const starts = [0];

  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }

  return starts;
}

/** Index of the line containing `offset`, via binary search. */
function lineOf(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  let found = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((starts[mid] ?? 0) <= offset) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }

  return found;
}

interface PlacedFrame {
  frame: SvgRangedFrame;
  top: number;
  width: number;
  height: number;
}

/**
 * Source-aligned layout. The first frame sits at the top; each later frame
 * follows the source lines that separate it from the previous one, pushed
 * down only when the previous frame would overlap it. A run of blank lines
 * collapses into one line height, matching the compiled output.
 */
const layout = computed<{ placed: PlacedFrame[]; height: number }>(() => {
  if (frames.value.length === 0) return { placed: [], height: 0 };

  const starts = lineStarts(props.text.value);
  const lineHeight = editorLineHeight();

  let bottom = 0;
  let previousLine: number | undefined;
  let effectiveLine = 0;

  const placed = frames.value.map((frame) => {
    const match = frame.render.svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const width = match ? Number(match[1]) : frame.render.width;
    const height = match ? Number(match[2]) : frame.render.height;

    const currentLine = lineOf(starts, frame.range.start);
    const first = previousLine === undefined;

    if (previousLine !== undefined) {
      const gap = Math.max(1, currentLine - previousLine);
      // One line break is one line; a run of blank lines adds one more.
      effectiveLine += gap > 1 ? 2 : 1;
    }

    const top = first ? 0 : Math.max(effectiveLine * lineHeight, bottom);

    bottom = top + height;
    previousLine = lineOf(starts, frame.range.end);

    return { frame, top, width, height };
  });

  return { placed, height: bottom };
});

function frameStyle(entry: PlacedFrame): Record<string, string> {
  return {
    top: `${entry.top}px`,
    "--frame-w": `${entry.width}px`,
    "--frame-h": `${entry.height}px`,
  };
}

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
  <div ref="scroller" class="paged-preview" @click="onPreviewClick">
    <div v-if="rendering" class="paged-preview__status">rendering...</div>
    <div class="paged-preview__inner">
      <div class="paged-preview__flow" :style="{ height: `${layout.height}px` }">
        <div
          v-for="(entry, index) in layout.placed"
          :key="index"
          :data-frame="index"
          class="paged-preview__frame"
          :style="frameStyle(entry)"
        >
          <!-- eslint-disable-next-line vue/no-v-html -- the wasm engine produced this SVG markup -->
          <div v-html="entry.frame.render.svg" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.paged-preview {
  height: 100%;
  min-height: 0;
  /* Always reserve the scrollbar. The frame width is compiled from the pane
     box, so the available width must not toggle a reflow. */
  overflow-y: scroll;
  background: var(--color-surface);
}

.paged-preview::-webkit-scrollbar {
  width: 10px;
}

.paged-preview::-webkit-scrollbar-track {
  background: transparent;
}

.paged-preview::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border: 2px solid transparent;
  border-radius: var(--radius-full);
  background-clip: content-box;
}

.paged-preview::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-text-secondary);
  background-clip: content-box;
}

.paged-preview :deep(a[href]) {
  cursor: pointer;
}

.paged-preview__status {
  position: sticky;
  top: var(--space-2);
  z-index: 1;
  margin: var(--space-2);
  padding: var(--space-1) var(--space-2-5);
  width: fit-content;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  background: color-mix(in srgb, var(--color-surface) 88%, transparent);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}

.paged-preview__inner {
  padding: var(--space-4) var(--space-5) var(--space-12);
}

.paged-preview__flow {
  position: relative;
  /* The frames are absolutely positioned at their source-aligned offsets, so
     the flow needs an explicit height to keep the scrollbar honest. */
  min-height: 100%;
}

@media (max-width: 768px) {
  .paged-preview__inner {
    padding: var(--space-3) var(--space-3) var(--space-8);
  }
}

.paged-preview__frame {
  position: absolute;
  left: 0;
  right: 0;
  /* Clip a render that is wider than the pane (mid-resize) instead of
     stretching it or growing a horizontal scrollbar. */
  overflow: hidden;
  cursor: text;
}

.paged-preview__frame :deep(svg) {
  display: block;
  width: var(--frame-w) !important;
  height: var(--frame-h) !important;
}
</style>
