<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";
import type { PageMeta } from "@typbase/typing";

const props = defineProps<{
  store: WorkspaceStore;
}>();

const emit = defineEmits<{
  (e: "select", pageId: string): void;
  (e: "deleted", pageId: string): void;
}>();

const { t, locale } = useI18n();
const { dataRevision } = useWorkspace();

function formatDayLabel(iso: string): string {
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}
const open = defineModel<boolean>("open", { default: false });

const today = new Date();
const viewYear = ref(today.getUTCFullYear());
const viewMonth = ref(today.getUTCMonth());

const dailyPages = computed(() => {
  void dataRevision.value;
  const map = new Map<string, PageMeta>();
  for (const page of props.store.listPages()) {
    const match = /^daily\/(\d{4}-\d{2}-\d{2})\.typ$/.exec(page.path);
    if (match) map.set(match[1]!, page);
  }

  return map;
});

interface Cell {
  iso: string;
  day: number;
  page: PageMeta | undefined;
  outside: boolean;
}

const grid = computed<Cell[]>(() => {
  const year = viewYear.value;
  const month = viewMonth.value;
  const first = new Date(Date.UTC(year, month, 1));
  const startOffset = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const cells: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const offset = i - startOffset + 1;
    const iso = isoOf(year, month, offset);
    const date = new Date(Date.UTC(year, month, offset));
    cells.push({
      iso,
      day: date.getUTCDate(),
      page: dailyPages.value.get(iso),
      outside: offset < 1 || offset > daysInMonth,
    });
  }

  return cells;
});

function isoOf(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month, day));
  return date.toISOString().slice(0, 10);
}

const monthLabel = computed(() =>
  new Date(Date.UTC(viewYear.value, viewMonth.value, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }),
);

function shiftMonth(delta: number) {
  const next = viewMonth.value + delta;
  viewMonth.value = (next + 12) % 12;
  if (next < 0) viewYear.value -= 1;
  else if (next >= 12) viewYear.value += 1;
}

function goToToday() {
  viewYear.value = today.getUTCFullYear();
  viewMonth.value = today.getUTCMonth();
}

async function openDay(cell: Cell) {
  if (cell.outside) return;

  const page = await props.store.createDailyNote(cell.iso);
  open.value = false;
  emit("select", page.id);
}

async function deleteDay(cell: Cell) {
  if (!cell.page) return;

  const parsed = new Date(`${cell.iso}T00:00:00Z`);
  const label = parsed.toLocaleDateString(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  if (!window.confirm(t("calendar.deleteConfirm", { date: formatDayLabel(cell.iso) }))) return;

  await props.store.deletePage(cell.page.id);
  emit("deleted", cell.page.id);
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger as-child>
      <slot />
    </DialogTrigger>

    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog">
        <DialogTitle class="dialog__title">{{ $t("calendar.title") }}</DialogTitle>
        <DialogDescription class="dialog__description">
          {{ $t("calendar.description") }}
        </DialogDescription>

        <div class="calendar__toolbar">
          <button
            type="button"
            class="button button--icon"
            :aria-label="$t('calendar.previousMonth')"
            @click="shiftMonth(-1)"
          >
            <MsIcon name="chevron_left" :size="20" />
          </button>
          <span class="calendar__month">{{ monthLabel }}</span>
          <button
            type="button"
            class="button button--icon"
            :aria-label="$t('calendar.nextMonth')"
            @click="shiftMonth(1)"
          >
            <MsIcon name="chevron_right" :size="20" />
          </button>
          <button type="button" class="button button--ghost button--tiny" @click="goToToday">
            Today
          </button>
        </div>

        <div class="calendar__grid" role="grid" aria-label="Monthly calendar">
          <span
            v-for="weekday in WEEKDAYS"
            :key="weekday"
            class="calendar__weekday"
            aria-hidden="true"
          >
            {{ weekday }}
          </span>

          <button
            v-for="cell in grid"
            :key="cell.iso"
            type="button"
            role="gridcell"
            class="calendar__cell"
            :class="{
              'calendar__cell--outside': cell.outside,
              'calendar__cell--today': cell.iso === today.toISOString().slice(0, 10),
            }"
            :aria-label="
              cell.page
                ? t('calendar.cell', { date: cell.iso })
                : t('calendar.cellEmpty', { date: cell.iso })
            "
            :disabled="cell.outside"
            @click="openDay(cell)"
          >
            <span class="calendar__day">{{ cell.day }}</span>
            <span v-if="cell.page" class="calendar__dot" aria-hidden="true" />
            <button
              v-if="cell.page"
              type="button"
              class="calendar__delete"
              :aria-label="t('calendar.deleteAria', { date: cell.iso })"
              @click.stop="deleteDay(cell)"
            >
              <MsIcon name="delete" :size="14" />
            </button>
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.calendar__toolbar {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.6rem;
}

.calendar__month {
  flex: 1;
  text-align: center;
  font-weight: 600;
  font-size: 0.95rem;
}

.calendar__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.15rem;
}

.calendar__weekday {
  text-align: center;
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  padding: 0.15rem 0;
}

.calendar__cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
  min-height: 2.4rem;
  padding: 0.15rem;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0.4rem;
  cursor: pointer;
  color: var(--color-text);
}

.calendar__cell:hover {
  background: var(--color-surface-2);
  border-color: var(--color-border);
}

.calendar__cell--outside {
  opacity: 0.35;
  pointer-events: none;
}

.calendar__cell--today {
  border-color: var(--color-accent);
}

.calendar__day {
  font-size: 0.85rem;
  line-height: 1;
}

.calendar__dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 999px;
  background: var(--color-accent);
}

.calendar__delete {
  position: absolute;
  top: 0.05rem;
  right: 0.05rem;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0.1rem;
  color: var(--color-danger);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.3rem;
}

.calendar__cell:hover .calendar__delete,
.calendar__cell:focus-within .calendar__delete {
  display: inline-flex;
}
</style>
