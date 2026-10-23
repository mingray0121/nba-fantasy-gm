import type { ReactNode } from "react";

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

const TONES = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  blue: "bg-court-100 text-court-700 dark:bg-slate-800 dark:text-sky-200",
  gray: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export function Badge({ tone = "gray", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const s = status.toUpperCase();
  const tone = ["O", "OUT", "INJ", "SUSP", "IL", "IL+"].includes(s) ? "red" : ["GTD", "DTD", "QUESTIONABLE", "DOUBTFUL"].includes(s) ? "amber" : "gray";
  return <Badge tone={tone}>{status}</Badge>;
}

export function Loading() {
  return <div className="card p-6 text-sm text-slate-500">Loading…</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  const e = error as Error & { problems?: string[] };
  return (
    <div className="card border-red-200 p-4 text-sm text-red-700 dark:border-red-900 dark:text-red-300">
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
  return <div className="card p-6 text-sm text-slate-500">{children}</div>;
}

export function fmtTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function timeAgo(d: Date | string | null) {
  if (!d) return "never";
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
