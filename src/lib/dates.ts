/** Small date helpers. All "day" math is done on calendar dates in UTC to stay deterministic. */

export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Parse a YYYY-MM-DD string to a UTC Date at midnight. */
export function parseISO(d: string): Date {
  return new Date(d + "T00:00:00.000Z");
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** Whole calendar days from `from` to `to` (to - from). Negative if `to` is in the past. */
export function daysBetween(from: Date, to: Date): number {
  const ms = parseISO(isoDate(to)).getTime() - parseISO(isoDate(from)).getTime();
  return Math.round(ms / 86_400_000);
}

/** Next weekday (Mon–Fri) strictly after `d`. Approximation of "next business day" (ignores holidays). */
export function nextBusinessDay(d: Date): Date {
  let r = addDays(d, 1);
  while (r.getUTCDay() === 0 || r.getUTCDay() === 6) r = addDays(r, 1);
  return r;
}

export function weekdayName(d: Date): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getUTCDay()];
}

/** Pretty long date, e.g. "Friday, 19 June 2026". */
export function prettyDate(iso: string): string {
  const d = parseISO(iso);
  return `${weekdayName(d)}, ${d.getUTCDate()} ${
    ["January","February","March","April","May","June","July","August","September","October","November","December"][d.getUTCMonth()]
  } ${d.getUTCFullYear()}`;
}
