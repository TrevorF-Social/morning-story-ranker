// Idempotent DB initializer. Runs as Render's `predeployCommand` so a deploy
// never lands ahead of its schema.
//
// What it does, in order:
//   1. Ensures a `_migrations` tracking table exists.
//   2. Walks db/migrations/*.sql in filename order. For each file not yet in
//      `_migrations`, applies the SQL and records it. Each migration runs in
//      its own transaction.
//   3. Always re-applies db/seed.sql (relies on the seed's own
//      `on conflict do nothing` clauses).
//
// Safe to run every deploy: already-applied migrations are skipped, the seed
// is idempotent.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const SEED_FILE = path.join(ROOT, "db", "seed.sql");

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`init-db: ${name} env var is required`);
    process.exit(1);
  }
  return v;
}

const sql = postgres(need("DATABASE_URL"), {
  ssl: "require",
  max: 1,
  idle_timeout: 5,
  // postgres.js can't run arbitrary multi-statement SQL via tagged templates;
  // we use sql.unsafe() which calls the driver's simple-query protocol and
  // accepts a SQL string with multiple statements.
});

async function ensureMigrationsTable() {
  await sql.unsafe(`
    create table if not exists _migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function appliedFilenames() {
  const rows = await sql`select filename from _migrations`;
  return new Set(rows.map((r) => r.filename));
}

async function applyMigrations() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  const files = entries.filter((n) => n.endsWith(".sql")).sort();
  if (files.length === 0) {
    console.log("init-db: no migrations to apply");
    return;
  }
  const done = await appliedFilenames();
  let appliedCount = 0;
  for (const filename of files) {
    if (done.has(filename)) {
      console.log(`init-db: skip ${filename} (already applied)`);
      continue;
    }
    const fullPath = path.join(MIGRATIONS_DIR, filename);
    const body = await fs.readFile(fullPath, "utf8");
    console.log(`init-db: applying ${filename}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into _migrations (filename) values (${filename})`;
    });
    appliedCount++;
  }
  console.log(`init-db: applied ${appliedCount} new migration(s)`);
}

async function applySeed() {
  try {
    const body = await fs.readFile(SEED_FILE, "utf8");
    console.log("init-db: applying seed.sql (idempotent)");
    await sql.unsafe(body);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("init-db: no seed.sql, skipping");
      return;
    }
    throw err;
  }
}

try {
  await ensureMigrationsTable();
  await applyMigrations();
  await applySeed();
  await sql.end();
  console.log("init-db: ok");
} catch (err) {
  console.error("init-db: failed", err);
  try {
    await sql.end();
  } catch {
    /* noop */
  }
  process.exit(1);
}
