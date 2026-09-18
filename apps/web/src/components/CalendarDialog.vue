<script setup lang="ts">
import type { WorkspaceStore } from "@typbase/storage";

import { getLocalTimeZone, isSameMonth, today, type DateValue } from "@internationalized/date";

const props = defineProps<{
  store: WorkspaceStore;
}>();

const emit = defineEmits<{
  (e: "select", pageId: string): void;
}>();

const { t, locale } = useI18n();
const { dataRevision } = useWorkspace();

const open = defineModel<boolean>("open", { default: false });

/** Month the calendar shows; reka updates it on prev/next navigation.
 *  shallowRef: ref() maps class values structurally and drops the DateValue brand. */
const placeholder = shallowRef<DateValue>(today(getLocalTimeZone()));

/**
 * Picked day. reka's cell trigger selects on click and on Enter/Space, so the
 * watch is what opens the note; it resets immediately so picking the same day
 * again still counts as a change.
 */
const selected = shallowRef<DateValue>();
watch(selected, (day) => {
  if (!day) return;
  selected.value = undefined;
  void openDay(day);
});

/** Dates that already have a daily note, for the dot marker. */
const dailyDates = computed(() => {
  void dataRevision.value;
  const dates = new Set<string>();
  for (const page of props.store.listPages()) {
    const match = /^daily\/(\d{4}-\d{2}-\d{2})\.typ$/.exec(page.path);
    if (match) dates.add(match[1]!);
  }

  return dates;
});

function hasNote(day: DateValue): boolean {
  return dailyDates.value.has(day.toString());
}

async function openDay(day: DateValue) {
  // Defensive: reka disables outside days, but a stale selection must not
  // resolve to a date the view does not show.
  if (!isSameMonth(day, placeholder.value)) return;

  const page = await props.store.createDailyNote(day.toString());
  open.value = false;
  emit("select", page.id);
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
        <button type="button" class="button button--ghost button--tiny" @click="goToToday">
          {{ $t("common.today") }}
        </button>
      </CalendarHeader>

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
  </UiDialog>
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
  width: 100%;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0.15rem;
}

.calendar__weekday {
  padding: 0.15rem 0;
  font-size: 0.7rem;
  font-weight: 400;
  text-align: center;
  color: var(--color-text-secondary);
}

.calendar__cell {
  padding: 0;
  border: 1px solid transparent;
  border-radius: 0.4rem;
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
  gap: 0.1rem;
  width: 100%;
  min-height: 2.4rem;
  padding: 0.15rem;
  font-family: inherit;
  color: var(--color-text);
  background: transparent;
  border: none;
  border-radius: 0.4rem;
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
  font-size: 0.85rem;
  line-height: 1;
}

.calendar__dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 999px;
  background: var(--color-accent);
}
</style>
