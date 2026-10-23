"use client";

import { useSyncExternalStore } from "react";

/** Time zones the app can show tip times in. US Eastern matches Yahoo. */
export const TIME_ZONES = [
  { id: "America/New_York", label: "US ET" },
  { id: "Asia/Taipei", label: "TW" },
] as const;
export type TimeZoneId = (typeof TIME_ZONES)[number]["id"];

const KEY = "nfa_tz";
const DEFAULT: TimeZoneId = "America/New_York";
const listeners = new Set<() => void>();

function read(): TimeZoneId {
  try {
    const v = localStorage.getItem(KEY);
    if (TIME_ZONES.some((t) => t.id === v)) return v as TimeZoneId;
  } catch {
    // Storage blocked: fall back to the default.
  }
  return DEFAULT;
}

function write(tz: TimeZoneId) {
  try {
    localStorage.setItem(KEY, tz);
  } catch {
    // Not persisted; still switches for this page view.
  }
  current = tz;
  listeners.forEach((l) => l());
}

let current: TimeZoneId | null = null;

export function useTimeZone(): [TimeZoneId, (tz: TimeZoneId) => void] {
  const tz = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (current ??= read()),
    () => DEFAULT,
  );
  return [tz, write];
}

/** "7:00 PM" in the chosen time zone. */
export function fmtTipTime(iso: string | null, tz: TimeZoneId): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
}

export function TimeZoneToggle() {
  const [tz, setTz] = useTimeZone();
  return (
    <div className="flex overflow-hidden rounded-md border border-slate-200 text-xs dark:border-slate-700" role="group" aria-label="Time zone">
      {TIME_ZONES.map((t) => (
        <button
          key={t.id}
          className={`px-2 py-1 ${tz === t.id ? "bg-court-600 text-white" : "text-slate-600 dark:text-slate-300"}`}
          onClick={() => setTz(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
