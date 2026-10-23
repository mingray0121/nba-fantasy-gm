import { APP_TIMEZONE } from "./env";

/** YYYY-MM-DD for an instant, in the app's time zone (US Eastern by default). */
export function toLocalDate(d: Date = new Date(), tz: string = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function today(): string {
  return toLocalDate(new Date());
}

/** Adds days to a YYYY-MM-DD string. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeek(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/** Inclusive list of days from start to end. */
export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Fantasy week containing `day`, given the league's week start (0 = Sun, 1 = Mon). */
export function weekRange(day: string, weekStartDay = 1): { start: string; end: string } {
  const offset = (dayOfWeek(day) - weekStartDay + 7) % 7;
  const start = addDays(day, -offset);
  return { start, end: addDays(start, 6) };
}
