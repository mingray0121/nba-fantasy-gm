import Link from "next/link";
import type { ReactNode } from "react";

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

const TONES = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900",
  red: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900",
  amber: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900",
  blue: "bg-court-50 text-court-700 ring-court-100 dark:bg-slate-800 dark:text-sky-200 dark:ring-slate-700",
  gray: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
};

export function Badge({ tone = "gray", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/** A roster slot label, e.g. PG or Util. */
export function SlotPill({ slot, muted = false }: { slot: string; muted?: boolean }) {
  const bench = slot === "BN" || slot.startsWith("IL");
  return (
    <span
      className={`inline-flex min-w-10 justify-center rounded-md px-1.5 py-1 font-mono text-[11px] font-semibold ${
        muted || bench
          ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          : "bg-court-50 text-court-700 ring-1 ring-court-100 ring-inset dark:bg-slate-800 dark:text-sky-200 dark:ring-slate-700"
      }`}
    >
      {slot === "UTIL" ? "Util" : slot}
    </span>
  );
}

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const s = status.toUpperCase();
  const tone = ["O", "OUT", "INJ", "SUSP", "IL", "IL+"].includes(s)
    ? "red"
    : ["GTD", "DTD", "QUESTIONABLE", "DOUBTFUL"].includes(s)
      ? "amber"
      : "gray";
  return <Badge tone={tone}>{status}</Badge>;
}

export function Loading() {
  return (
    <div className="card flex items-center gap-3 p-6 text-sm text-slate-500">
      <span className="size-2 animate-pulse rounded-full bg-ember-500" />
      Loading…
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const e = error as Error & { problems?: string[] };
  return (
    <div className="card border-rose-200 bg-rose-50/60 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
      <p>{e?.message ?? "Something went wrong"}</p>
      {e?.problems && (
        <ul className="mt-2 list-disc pl-5">
          {e.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card border-dashed p-8 text-center text-sm text-slate-500">{children}</div>;
}

export function timeAgo(d: Date | string | null) {
  if (!d) return "never";
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** A player's name linking to his page (averages, previous games, schedule). */
export function PlayerLink({ id, name, leagueId, className = "" }: { id: number; name: string; leagueId: number; className?: string }) {
  return (
    <Link
      href={`/players/${id}?league=${leagueId}`}
      className={`hover:underline ${className}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {name}
    </Link>
  );
}
