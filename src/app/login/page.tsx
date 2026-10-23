export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold">Lineup Assistant</h1>
        <p className="mt-1 text-sm text-slate-500">Start, bench and add/drop help for your Yahoo Fantasy NBA leagues.</p>
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}
      <a href="/api/auth/yahoo/login" className="btn-primary py-3">
        Sign in with Yahoo
      </a>
      <p className="text-xs text-slate-500">Only the owner&apos;s Yahoo account can sign in.</p>
    </main>
  );
}
