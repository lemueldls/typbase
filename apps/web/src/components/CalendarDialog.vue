<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import { getLocalTimeZone, today, type DateValue } from "@internationalized/date";

import { dailyDate } from "~/lib/dailyNav";
import { formatDayLabel } from "~/lib/format";

const props = defineProps<{
  store: WorkspaceStore;
}>();

const emit = defineEmits<{
  (e: "select", pageId: string): void;
}>();

const { locale } = useI18n();

const open = defineModel<boolean>("open", { default: false });

/** Month the calendar shows. reka updates it on prev/next navigation.
 *  shallowRef: ref() maps class values structurally and drops the DateValue brand. */
const placeholder = shallowRef<DateValue>(today(getLocalTimeZone()));

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

/** Daily notes in reverse date order. reka's dot marker and the recent list
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
const recentNotes = computed(() => dailyNotes.value.slice(0, 6));

function hasNote(day: DateValue): boolean {
  return dailyDates.value.has(day.toString());
}

function recentLabel(iso: string): string {
  return formatDayLabel(iso, locale.value);
}

async function openDay(day: DateValue) {
  const page = await props.store.createDailyNote(day.toString());
  open.value = false;
  emit("select", page.id);
}

function openRecent(pageId: string): void {
  open.value = false;
  emit("select", pageId);
}

function openTyped(): void {
  if (!typedDate.value) return;

  void openDay(typedDate.value);
}

function goToToday() {
  placeholder.value = today(getLocalTimeZone());
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    :title="$t('calendar.title')"
    :description="$t('calendar.description')"
  >
    <template #trigger>
      <slot />
    </template>

    <CalendarRoot
      v-slot="{ weekDays, grid }"
      v-model="selected"
      v-model:placeholder="placeholder"
      :locale="locale"
      fixed-weeks
      disable-days-outside-current-view
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
        <UiButton variant="ghost" @click="goToToday">
          {{ $t("common.today") }}
        </UiButton>
      </CalendarHeader>

      <form class="calendar__jump" @submit.prevent="openTyped">
        <span class="calendar__jump-label">{{ $t("calendar.jumpTo") }}</span>
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
        <UiButton type="submit" variant="plain" size="small" :disabled="!typedDate">
          {{ $t("calendar.openDate") }}
        </UiButton>
      </form>

      <CalendarGrid v-for="month in grid" :key="month.value.toString()" class="calendar__grid">
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
              <CalendarCellTrigger :day="day" :month="month.value" class="calendar__open">
                <span class="calendar__day">{{ day.day }}</span>
                <span v-if="hasNote(day)" class="calendar__dot" aria-hidden="true" />
              </CalendarCellTrigger>
            </CalendarCell>
          </CalendarGridRow>
        </CalendarGridBody>
      </CalendarGrid>
    </CalendarRoot>

    <div v-if="recentNotes.length" class="calendar__recent">
      <p class="calendar__recent-title">{{ $t("calendar.recent") }}</p>
      <div class="calendar__recent-list">
        <button
          v-for="note in recentNotes"
          :key="note.id"
          type="button"
          class="calendar__recent-day"
          @click="openRecent(note.id)"
        >
          <MsIcon name="event_note" :size="16" />
          {{ recentLabel(note.iso) }}
        </button>
      </div>
    </div>
  </UiDialog>
</template>

<style>
.calendar__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  margin-bottom: var(--space-2-5);
}

.calendar__month {
  flex: 1;
  text-align: center;
  font-weight: 600;
  font-size: var(--text-lg);
}

.calendar__jump {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2-5);
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
  height: var(--control-sm);
  padding: 0 var(--space-2);
  font-size: var(--text-sm);
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
  border-radius: var(--radius-sm);
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
  min-height: var(--space-10);
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

.calendar__open[data-today] {
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

.calendar__recent {
  margin-top: var(--space-2-5);
  padding-top: var(--space-2-5);
  border-top: 1px solid var(--color-border);
}

.calendar__recent-title {
  margin: 0 0 var(--space-1-5);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.calendar__recent-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1-5);
}

.calendar__recent-day {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  font: inherit;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.calendar__recent-day:hover {
  color: var(--color-text);
  border-color: var(--color-border);
}
</style>
