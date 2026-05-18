type SearchParams = Promise<{ sent?: string; error?: string; next?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const sent = params.sent === "1";
  const error = params.error;
  const next = params.next ?? "";

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-neutral-900 mb-2">Morning Story Ranker</h1>
        <p className="text-sm text-neutral-600 mb-8">Sign in with a magic link.</p>

        {sent ? (
          <div className="rounded-lg border border-neutral-200 bg-white p-5">
            <p className="text-sm text-neutral-900 font-medium mb-1">Check your inbox.</p>
            <p className="text-sm text-neutral-600">
              If your email is on the allowlist, a sign-in link is on its way. It expires in 15
              minutes and works once.
            </p>
          </div>
        ) : (
          <form action="/api/auth/magic-link" method="post" className="space-y-3">
            <input type="hidden" name="next" value={next} />
            <label htmlFor="email" className="block text-sm font-medium text-neutral-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@yourcompany.com"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none"
            />
            <button
              type="submit"
              className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
            >
              Send magic link
            </button>
            {error === "invalid-link" && (
              <p className="text-xs text-red-600">
                That link expired or was already used. Request a new one.
              </p>
            )}
            {error === "send-failed" && (
              <p className="text-xs text-red-600">
                Couldn&apos;t send the email. Try again in a minute.
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
