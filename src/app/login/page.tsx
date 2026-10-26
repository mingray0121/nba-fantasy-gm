import { optionalEnv } from "@/lib/env";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const passwordEnabled = Boolean(optionalEnv("APP_PASSWORD"));
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold">Lineup Assistant</h1>
        <p className="mt-1 text-sm text-slate-500">Start, bench and add/drop help for your Yahoo Fantasy NBA leagues.</p>
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}
      {passwordEnabled && (
        <form method="post" action="/api/auth/password" className="flex flex-col gap-2">
          <input type="password" name="password" required placeholder="Password" className="input" autoComplete="current-password" />
          <button className="btn-primary py-3">Sign in</button>
        </form>
      )}
      <a href="/api/auth/yahoo/login" className={passwordEnabled ? "btn-secondary py-3" : "btn-primary py-3"}>
        Sign in with Yahoo
      </a>
      <p className="text-xs text-slate-500">Only the owner&apos;s Yahoo account can sign in.</p>
      <form method="post" action="/api/auth/demo" className="flex flex-col gap-2 border-t border-slate-200 pt-6 dark:border-slate-800">
        <button className="btn-secondary py-3">Try the demo</button>
        <p className="text-xs text-slate-500">
          No sign-in needed. You get a made-up 12-team league to play with; your changes reset when you close the browser.
        </p>
      </form>
    </main>
  );
}
