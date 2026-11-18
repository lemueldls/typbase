<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import { parseDate, type DateValue } from "@internationalized/date";

import { dailyDate } from "~/lib/dailyNav";
import { formatDate, formatDayLabel, todayISO } from "~/lib/format";

const props = defineProps<{
  store: WorkspaceStore;
}>();

const emit = defineEmits<{
  (e: "select", pageId: string): void;
}>();

const { t, locale } = useI18n();
const { confirm } = useConfirm();

const open = defineModel<boolean>("open", { default: false });

/**
 * Daily notes are keyed by UTC date everywhere else in the app (`todayISO`),
 * so the calendar's quick actions and today marker use the same date.
 */
const todayDate = parseDate(todayISO());
const yesterdayDate = todayDate.subtract({ days: 1 });
const tomorrowDate = todayDate.add({ days: 1 });
const todayIso = todayDate.toString();

/** Month the calendar shows. reka updates it on prev/next navigation.
 *  shallowRef: ref() maps class values structurally and drops the DateValue brand. */
const placeholder = shallowRef<DateValue>(todayDate);

/** True when the grid is showing the month that owns today's note. */
const isCurrentMonth = computed(
  () => placeholder.value.year === todayDate.year && placeholder.value.month === todayDate.month,
);

/** Wide dialogs show the calendar beside the list; narrow ones start with the
 *  list and let the calendar be opened from its section header. */
const wide = useMediaQuery("(min-width: 48rem)");
const calendarOpen = ref(wide.value);
watch(wide, (value) => {
  calendarOpen.value = value;
});

/**
 * Picked day. reka's cell trigger selects on click and on Enter/Space, so the
 * watch is what opens the note. It resets immediately so picking the same day
 * again still counts as a change.
 */
const selected = shallowRef<DateValue>();
watch(selected, (day) => {
  if (!day) return;
  selected.value = undefined;
  void openDay(day);
});

/** Typed date from the field above the grid. Opens only on submit, so a year
 *  typed one digit at a time does not create a note on every keystroke. */
const typedDate = shallowRef<DateValue>();

/** Daily notes in reverse date order. reka's dot marker and the note list
 *  both read this. */
const dailyNotes = useWorkspaceValue(
  () => props.store,
  ["pages"],
  (store) => {
    const notes: Array<{ id: string; iso: string }> = [];
    for (const page of store.listPages()) {
      const iso = dailyDate(page.path);
      if (iso) notes.push({ id: page.id, iso });
    }

    return notes.sort((a, b) => b.iso.localeCompare(a.iso));
  },
);

const dailyDates = computed(() => new Set(dailyNotes.value.map((note) => note.iso)));

/** Full note list filter. Typing a year or a month keeps the list manageable. */
const noteQuery = ref("");
const filteredNotes = computed(() => {
  if (dailyNotes.value.length <= 6) return dailyNotes.value;

  const needle = noteQuery.value.trim().toLowerCase();
  if (!needle) return dailyNotes.value;

  return dailyNotes.value.filter(
    (note) => note.iso.includes(needle) || noteLabel(note.iso).toLowerCase().includes(needle),
  );
});

function hasNote(day: DateValue): boolean {
  return dailyDates.value.has(day.toString());
}

function dayLabel(day: DateValue): string {
  return formatDayLabel(day.toString(), locale.value);
}

function cellLabel(day: DateValue): string {
  return hasNote(day)
    ? t("calendar.cell", { date: dayLabel(day) })
    : t("calendar.cellEmpty", { date: dayLabel(day) });
}

function noteLabel(iso: string): string {
  return formatDate(
    iso,
    { weekday: "long", month: "long", day: "numeric", year: "numeric" },
    locale.value,
  );
}

/** Delete one daily note from the list. The open page, if it is this note,
 *  clears itself through the shell's missing-page watcher. */
const deleteError = ref("");
async function removeNote(note: { id: string; iso: string }): Promise<void> {
  const confirmed = await confirm({
    title: t("calendar.deleteTitle"),
    description: t("calendar.deleteConfirm", { date: noteLabel(note.iso) }),
    confirmLabel: t("common.delete"),
  });
  if (!confirmed) return;

  deleteError.value = "";
  try {
    await props.store.deletePage(note.id);
  } catch (cause) {
    deleteError.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function openDay(day: DateValue) {
  const page = await props.store.createDailyNote(day.toString());
  open.value = false;
  emit("select", page.id);
}

function openNote(pageId: string): void {
  open.value = false;
  emit("select", pageId);
}

function openTyped(): void {
  const day = typedDate.value;
  if (!day) return;

  typedDate.value = undefined;
  void openDay(day);
}

function openRelative(day: DateValue): void {
  void openDay(day);
}

function goToToday() {
  placeholder.value = todayDate;
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    class="calendar-dialog"
    :title="$t('calendar.title')"
    :description="$t('calendar.description')"
  >
    <template #trigger>
      <slot />
    </template>

    <div class="calendar__layout">
      <section class="calendar__notes">
        <!-- <div class="calendar__notes-head">
          <p class="calendar__notes-title">
            <MsIcon name="event_note" :size="18" />
            {{ $t("calendar.allNotes") }}
          </p>
          <span class="calendar__notes-count" aria-hidden="true">{{ dailyNotes.length }}</span>
        </div> -->

        <UiTextField
          v-if="dailyNotes.length > 6"
          v-model="noteQuery"
          type="search"
          :placeholder="$t('calendar.searchNotes')"
          :aria-label="$t('calendar.searchNotes')"
          class="calendar__notes-search"
        >
          <template #leading>
            <MsIcon name="search" :size="20" />
          </template>
        </UiTextField>

        <ul v-if="filteredNotes.length" class="calendar__notes-list">
          <li v-for="note in filteredNotes" :key="note.id" class="calendar__note-row">
            <button type="button" class="calendar__note" @click="openNote(note.id)">
              <MsIcon name="event_note" :size="18" />
              <span class="calendar__note-date">{{ noteLabel(note.iso) }}</span>
            </button>
            <UiMenu>
              <template #trigger>
                <UiIconButton
                  icon="more_vert"
                  :size="20"
                  :label="$t('sidebar.actions', { title: noteLabel(note.iso) })"
                  variant="ghost"
                  class="button--tiny calendar__note-more"
                />
              </template>
              <UiMenuItem danger icon="delete" @select="removeNote(note)">
                {{ $t("common.delete") }}
              </UiMenuItem>
            </UiMenu>
          </li>
        </ul>

        <p v-else class="calendar__notes-empty">
          {{ dailyNotes.length ? $t("calendar.notesEmpty") : $t("calendar.noNotes") }}
        </p>

        <p v-if="deleteError" class="calendar__error" role="alert">{{ deleteError }}</p>

        <form class="calendar__jump" @submit.prevent="openTyped">
          <!-- <span class="calendar__jump-label">{{ $t("calendar.jumpTo") }}</span> -->
          <DateFieldRoot
            v-model="typedDate"
            :locale="locale"
            granularity="day"
            :aria-label="$t('calendar.jumpTo')"
            class="calendar__date-field"
            @keydown.enter.prevent="openTyped"
          >
            <template #default="{ segments }">
              <DateFieldInput
                v-for="(segment, index) in segments"
                :key="`${segment.part}-${index}`"
                :part="segment.part"
                class="calendar__date-segment"
              >
                {{ segment.value }}
              </DateFieldInput>
            </template>
          </DateFieldRoot>
          <UiButton type="submit" variant="plain" :disabled="!typedDate">
            {{ $t("calendar.openDate") }}
          </UiButton>
        </form>
      </section>

      <div class="calendar__calendar">
        <UiCollapsible v-model:open="calendarOpen" class="calendar__collapse">
          <template #trigger>
            <span class="calendar__collapse-label">
              <MsIcon name="calendar_month" :size="18" />
              {{ $t("sidebar.calendar") }}
            </span>
          </template>

          <CalendarRoot
            v-slot="{ weekDays, grid }"
            v-model="selected"
            v-model:placeholder="placeholder"
            :locale="locale"
            fixed-weeks
            class="calendar"
          >
            <CalendarHeader class="calendar__toolbar">
              <UiTooltip :text="$t('calendar.previousMonth')">
                <CalendarPrev
                  class="button button--ghost button--icon"
                  :aria-label="$t('calendar.previousMonth')"
                >
                  <MsIcon name="chevron_left" :size="20" />
                </CalendarPrev>
              </UiTooltip>
              <CalendarHeading class="calendar__month" />
              <UiTooltip :text="$t('calendar.nextMonth')">
                <CalendarNext
                  class="button button--ghost button--icon"
                  :aria-label="$t('calendar.nextMonth')"
                >
                  <MsIcon name="chevron_right" :size="20" />
                </CalendarNext>
              </UiTooltip>
              <UiIconButton
                icon="today"
                :label="$t('calendar.thisMonth')"
                :disabled="isCurrentMonth"
                variant="ghost"
                @click="goToToday"
              />
            </CalendarHeader>

            <CalendarGrid
              v-for="month in grid"
              :key="month.value.toString()"
              class="calendar__grid"
            >
              <CalendarGridHead>
                <CalendarGridRow>
                  <CalendarHeadCell v-for="day in weekDays" :key="day" class="calendar__weekday">
                    {{ day }}
                  </CalendarHeadCell>
                </CalendarGridRow>
              </CalendarGridHead>
              <CalendarGridBody>
                <CalendarGridRow v-for="(week, weekIndex) in month.rows" :key="weekIndex">
                  <CalendarCell
                    v-for="day in week"
                    :key="day.toString()"
                    :date="day"
                    class="calendar__cell"
                  >
                    <CalendarCellTrigger
                      :day="day"
                      :month="month.value"
                      class="calendar__open"
                      :class="{ calendar__today: day.toString() === todayIso }"
                      :aria-label="cellLabel(day)"
                      :aria-current="day.toString() === todayIso ? 'date' : undefined"
                    >
                      <span class="calendar__day">{{ day.day }}</span>
                      <span v-if="hasNote(day)" class="calendar__dot" aria-hidden="true" />
                    </CalendarCellTrigger>
                  </CalendarCell>
                </CalendarGridRow>
              </CalendarGridBody>
            </CalendarGrid>
          </CalendarRoot>

          <!-- <div class="calendar__quick">
            <span class="calendar__quick-title">{{ $t("calendar.quick") }}</span>
            <UiButton variant="plain" @click="openRelative(yesterdayDate)">
              {{ $t("calendar.yesterday") }}
            </UiButton>
            <UiButton variant="plain" @click="openRelative(todayDate)">
              {{ $t("common.today") }}
            </UiButton>
            <UiButton variant="plain" @click="openRelative(tomorrowDate)">
              {{ $t("calendar.tomorrow") }}
            </UiButton>
          </div> -->
        </UiCollapsible>
      </div>
    </div>
  </UiDialog>
</template>

<style>
.calendar__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  margin-bottom: var(--space-2);
}

.calendar__month {
  flex: 1;
  text-align: center;
  font-weight: 600;
  font-size: var(--text-lg);
}

.calendar__collapse {
  min-width: 0;
}

.calendar__collapse-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
}

.calendar__collapse .ui-collapsible__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1-5);
  width: 100%;
  height: var(--control-sm);
  margin: 0 0 var(--space-2);
  padding: 0 var(--space-2);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text);
  border-radius: var(--radius-sm);
  transition: background var(--motion-fast);
}

.calendar__collapse .ui-collapsible__trigger:hover {
  background: var(--color-surface-2);
}

.calendar__jump {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1-5) var(--space-2);
  margin-top: auto;
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border);
}

.calendar__jump-label {
  flex: none;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.calendar__date-field {
  display: flex;
  align-items: center;
  gap: 1px;
  height: var(--control-md);
  padding: 0 var(--space-3);
  font-size: var(--text-md);
  font-variant-numeric: tabular-nums;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.calendar__date-field:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-focus-ring);
}

.calendar__date-segment {
  padding: 1px 2px;
  color: var(--color-text);
  border-radius: var(--radius-xs);
  outline: none;
}

.calendar__date-segment[data-reka-date-field-segment="literal"] {
  color: var(--color-text-secondary);
}

.calendar__date-segment:focus {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.calendar__grid {
  width: 100%;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: var(--space-0-5);
}

.calendar__weekday {
  padding: var(--space-0-5) 0;
  font-size: var(--text-2xs);
  font-weight: 400;
  text-align: center;
  color: var(--color-text-secondary);
}

.calendar__cell {
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  text-align: center;
  vertical-align: middle;
}

.calendar__cell:hover,
.calendar__cell:focus-within {
  background: var(--color-surface-2);
  border-color: var(--color-border);
}

/* The day opens the note. reka renders the trigger as a focusable div with
   role, so it is styled like a button here. */
.calendar__open {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-0-5);
  width: 100%;
  min-height: var(--control-md);
  padding: var(--space-0-5);
  font-family: inherit;
  color: var(--color-text);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.calendar__open[data-disabled] {
  opacity: 0.35;
  cursor: default;
}

/* Days from the next or previous month are still selectable. Mute them so the
   current month stays the visual focus, but hover restores full contrast. */
.calendar__open[data-outside-view] {
  color: var(--color-text-secondary);
  opacity: 0.65;
}

.calendar__open[data-outside-view]:hover {
  opacity: 1;
}

.calendar__today {
  box-shadow: inset 0 0 0 1px var(--color-accent);
}

.calendar__open[data-selected] {
  background: var(--color-accent-soft);
}

.calendar__day {
  font-size: var(--text-md);
  line-height: var(--leading-none);
}

.calendar__dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: var(--radius-full);
  background: var(--color-accent);
}

.calendar__quick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1-5);
  margin-top: var(--space-2-5);
}

.calendar__quick-title {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  margin-right: var(--space-0-5);
}

.calendar__layout {
  display: grid;
  gap: 0;
  align-items: stretch;
}

.calendar__notes {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.calendar__calendar {
  min-width: 0;
  margin-top: var(--space-2-5);
  padding-top: var(--space-2-5);
  border-top: 1px solid var(--color-border);
}

.calendar__notes-head {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-1-5);
  min-height: var(--control-sm);
  margin-bottom: var(--space-2);
}

.calendar__notes-title {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text);
}

.calendar__notes-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--control-xs);
  height: var(--control-xs);
  padding: 0 var(--space-1);
  font-size: var(--text-2xs);
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border-radius: var(--radius-full);
}

.calendar__notes-search {
  margin-bottom: var(--space-2);
}

.calendar__notes-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 14rem;
  margin: 0;
  padding: 0;
  padding-bottom: var(--space-2);
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
}

.calendar__note-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding-right: var(--space-1-5);
  border-radius: var(--radius-sm);
}

.calendar__note-row:hover,
.calendar__note-row:focus-within {
  background: var(--color-surface-2);
}

.calendar__note-more {
  flex: none;
  opacity: 0;
  border-radius: var(--radius-xs);
  transition: opacity var(--motion-fast);
}

.calendar__note-row:hover .calendar__note-more,
.calendar__note-row .calendar__note-more:focus-visible,
.calendar__note-row .calendar__note-more[data-state="open"] {
  opacity: 1;
}

@media (hover: none) {
  .calendar__note-more {
    opacity: 1;
  }
}

.calendar__note {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  height: var(--control-md);
  padding: 0 var(--space-2);
  font: inherit;
  font-size: var(--text-sm);
  color: var(--color-text);
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.calendar__note-date {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar__notes-empty {
  margin: var(--space-1-5) 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.calendar__error {
  margin: var(--space-1-5) 0 0;
  font-size: var(--text-sm);
  color: var(--color-danger);
}

@media (min-width: 48rem) {
  .dialog.calendar-dialog {
    width: min(56rem, calc(100vw - var(--space-8)));
  }

  .calendar__layout {
    grid-template-columns: minmax(0, 1fr) 22rem;
    gap: var(--space-2);
  }

  .calendar__calendar {
    margin-top: 0;
    padding-top: 0;
    padding-left: var(--space-4);
    border-top: 0;
    border-left: 1px solid var(--color-border);
  }

  /* Desktop always shows the calendar, so its mobile accordion header has no
     job here. */
  .calendar__collapse .ui-collapsible__trigger {
    display: none;
  }

  .calendar__notes-list {
    max-height: min(24rem, calc(100dvh - 16rem));
  }
}
</style>
