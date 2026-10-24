"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

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

/** The current time, refreshed every 15 seconds (null until mounted, to avoid a hydration mismatch). */
function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Live US Eastern and Taiwan clocks; clicking one makes it the zone for tip times. */
export function TimeZoneToggle() {
  const [tz, setTz] = useTimeZone();
  const now = useNow();
  return (
    <div className="flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-medium dark:bg-slate-800" role="group" aria-label="Time zone">
      {TIME_ZONES.map((t) => (
        <button
          key={t.id}
          className={`rounded-md px-2 py-1 transition-colors ${
            tz === t.id ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500 hover:text-slate-700"
          }`}
          onClick={() => setTz(t.id)}
          title={`Show tip times in ${t.label}`}
        >
          <span className="text-slate-400">{t.label}</span>{" "}
          <span className="tabular-nums">{now ? fmtTipTime(now.toISOString(), t.id) : "--:--"}</span>
        </button>
      ))}
    </div>
  );
}
