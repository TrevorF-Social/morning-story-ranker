import { sql } from "@/app/lib/db";
import { ingestVertical, type IngestReport } from "@/app/lib/sources/ingest";
import { rankVertical, type RankReport } from "@/app/lib/ranking";

/**
 * Shared "run ingest + rank then log it" helper. Both the cron route and the
 * Refresh button hit this so the dashboard's "last refreshed" state and
 * Reddit-availability banner read from a single source of truth.
 */

export type RunResult = {
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  ingest: IngestReport;
  ranking: RankReport;
};

export async function runIngestAndRank(
  vertical: string,
  opts: { triggeredBy: "cron" | "refresh"; force?: boolean },
): Promise<RunResult> {
  const startedAt = new Date();
  const ingest = await ingestVertical(vertical, { force: opts.force, now: startedAt });
  const ranking = await rankVertical(vertical, { now: startedAt });
  const finishedAt = new Date();

  // Round-trip through JSON so Date fields in the reports become ISO strings
  // (sql.json's TS type rejects raw Date values).
  const ingestJson = JSON.parse(JSON.stringify(ingest));
  const rankingJson = JSON.parse(JSON.stringify(ranking));

  await sql`
    insert into ingest_runs (vertical, started_at, finished_at, ingest_report, ranking_report, triggered_by, user_email, forced)
    values (
      ${vertical},
      ${startedAt},
      ${finishedAt},
      ${sql.json(ingestJson)},
      ${sql.json(rankingJson)},
      ${opts.triggeredBy},
      ${null},
      ${opts.force === true}
    )
  `;

  return {
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    ingest,
    ranking,
  };
}

/** Latest run for this vertical, or null if none yet. */
export async function latestRun(vertical: string): Promise<{
  startedAt: Date;
  finishedAt: Date;
  ingest: IngestReport;
  ranking: RankReport;
} | null> {
  const rows = await sql<
    {
      started_at: Date;
      finished_at: Date;
      ingest_report: IngestReport;
      ranking_report: RankReport;
    }[]
  >`
    select started_at, finished_at, ingest_report, ranking_report
      from ingest_runs
     where vertical = ${vertical}
     order by started_at desc
     limit 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    startedAt: new Date(r.started_at),
    finishedAt: new Date(r.finished_at),
    ingest: r.ingest_report,
    ranking: r.ranking_report,
  };
}
