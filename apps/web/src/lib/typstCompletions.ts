import type { TypstState } from "@typbase/engine";
import type { WorkspaceStore } from "@typbase/storage";

/** One value the engine offers inside a `typbase` string argument. */
interface CompletionValue {
  /** Text shown and matched in the completion list. */
  label: string;
  /** Text inserted into the source. */
  value: string;
  /** Optional detail line shown beside the entry. */
  detail?: string;
}

/**
 * Workspace lists the engine's completion pass reads. Keys match
 * `CompletionData` in `packages/engine/src/complete.rs`.
 */
interface CompletionData {
  pages: CompletionValue[];
  categories: CompletionValue[];
  /** Months with at least one daily note, as `YYYY-MM`. */
  months: CompletionValue[];
  /** Dates with a daily note, as `YYYY-MM-DD`. */
  dates: CompletionValue[];
  plugins: CompletionValue[];
}

const DAILY_PATH = /^daily\/(\d{4}-\d{2}-\d{2})\.typ$/;

/**
 * Builds the workspace values `#typbase.page-link`, `embed`, and `query`
 * complete from. Lists show titles and names, while insertion uses the id the
 * stdlib actually expects.
 */
export function workspaceCompletionData(store: WorkspaceStore): CompletionData {
  const pages = store.listPages();
  const categories = store.listCategories();
  const months = new Map<string, number>();
  const dates: CompletionValue[] = [];

  for (const page of pages) {
    const date = DAILY_PATH.exec(page.path)?.[1];
    if (!date) continue;

    dates.push({ label: date, value: date, detail: page.title });
    const month = date.slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + 1);
  }

  return {
    pages: pages.map((page) => ({
      label: page.title || page.path,
      value: page.id,
      detail: page.path,
    })),
    categories: categories.map((category) => ({
      label: category.name,
      value: category.id,
    })),
    months: [...months.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([month, count]) => ({
        label: month,
        value: month,
        detail: `${count} daily ${count === 1 ? "note" : "notes"}`,
      })),
    dates: dates.sort((left, right) => right.value.localeCompare(left.value)),
    plugins: store.listPluginInstances().map((instance) => ({
      label: instance.title || instance.pluginId,
      value: instance.id,
      detail: instance.pluginId,
    })),
  };
}

/**
 * Replaces the values one wasm instance completes from. Call this when the
 * page, category, daily, or plugin lists change, not on every completion.
 */
export function applyCompletionData(state: TypstState, store: WorkspaceStore): void {
  try {
    state.setCompletionData(workspaceCompletionData(store));
  } catch (error) {
    // Completion is optional. A bad payload must not stop the page from
    // opening; the next compile reports a real engine failure.
    console.warn("[typst] completion data update failed:", error);
  }
}
