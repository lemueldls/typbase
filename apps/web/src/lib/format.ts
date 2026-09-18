const DAY_MS = 86_400_000;

function toDate(value: string | number | Date): Date {
  if (typeof value === "number") return new Date(value);

  if (typeof value === "string") {
    // ISO date-only strings are UTC days; keep the calendar stable across
    // timezones (daily notes are UTC-keyed).
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00Z`);
    return new Date(value);
  }

  return value;
}

/** Formats a date; ISO date-only inputs stay in UTC. */
export function formatDate(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  const date = toDate(value);
  const isDateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const resolved: Intl.DateTimeFormatOptions = {
    timeZone: isDateOnly ? "UTC" : undefined,
    ...options,
  };
  try {
    return new Intl.DateTimeFormat(locale, resolved).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, resolved).format(date);
  }
}

/** Weekday headers for a calendar, in the given locale. */
export function weekdayLetters(locale?: string): string[] {
  // Reference Thursday: guarantees a complete week in every locale convention.
  const ref = new Date(Date.UTC(2024, 5, 6)); // Thursday
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(ref);
    day.setUTCDate(ref.getUTCDate() - 3 + i); // Sunday .. Saturday
    out.push(
      new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" })
        .format(day)
        .slice(0, 2),
    );
  }

  return out;
}

/** Human relative time ("just now", "3m ago") via Intl.RelativeTimeFormat. */
export function formatAgo(timestamp: number, locale?: string): string {
  const diff = timestamp - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always" });

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", DAY_MS],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const [unit, spanMs] = units.find(([, millis]) => abs >= millis) ?? ["minute", 60_000];

  return rtf.format(Math.round(diff / spanMs), unit);
}

/** Long form of a weekday+date for confirmations and headings. */
export function formatDayLabel(iso: string, locale?: string): string {
  return formatDate(iso, { dateStyle: "medium" }, locale);
}
