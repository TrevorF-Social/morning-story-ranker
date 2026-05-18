import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

function getClient(): ReturnType<typeof postgres> {
  if (global.__sql) return global.__sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL env var is required. For Neon: copy the pooled connection string from your project dashboard.",
    );
  }
  global.__sql = postgres(url, {
    ssl: "require",
    max: 5,
    idle_timeout: 20,
  });
  return global.__sql;
}

/**
 * `sql` is a lazy proxy over the postgres.js client. The client (and the
 * DATABASE_URL check) is initialized on first use, not at module load, so
 * `next build` doesn't require env vars to be present.
 *
 * postgres.js's client is callable (a tagged-template function) AND has
 * methods (`.begin`, `.unsafe`, ...), so we proxy both the call and the
 * property access.
 */
export const sql = new Proxy(function () {} as unknown as ReturnType<typeof postgres>, {
  apply(_target, _thisArg, args) {
    // @ts-expect-error — forwarding tagged-template call
    return getClient()(...args);
  },
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
