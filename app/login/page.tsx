type SearchParams = Promise<{ error?: string; next?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const error = params.error;
  const next = params.next ?? "";

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-neutral-900 mb-2">Morning Story Ranker</h1>
        <p className="text-sm text-neutral-600 mb-8">Internal access only.</p>

        <form action="/api/auth/login" method="post" className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="password" className="block text-sm font-medium text-neutral-700">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none"
          />
          <button
            type="submit"
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            Sign in
          </button>
          {error === "bad-password" && (
            <p className="text-xs text-red-600">Wrong password.</p>
          )}
        </form>
      </div>
    </main>
  );
}
