// Server-side ClickHouse reader for the score time series. Degrades gracefully:
// if ClickHouse is unreachable or empty, callers get [] and the UI shows an
// "accruing" state rather than erroring. Swap CLICKHOUSE_URL for ClickHouse
// Cloud in production; the query is identical.

import { createClient } from "@clickhouse/client";

const URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const DB = process.env.CLICKHOUSE_DB ?? "default";
const USER = process.env.CLICKHOUSE_USER ?? "default";
const PASS = process.env.CLICKHOUSE_PASSWORD ?? "";

export type HistoryPoint = { t: number; score: number };

export async function fetchHistory(mint: string, hours = 24): Promise<HistoryPoint[]> {
  try {
    const client = createClient({
      url: URL,
      database: DB,
      username: USER,
      password: PASS,
      request_timeout: 8000,
    });
    const rs = await client.query({
      query: `
        SELECT toUnixTimestamp(ts) AS t, score
        FROM asset_scores
        WHERE mint = {mint:String} AND ts > now() - INTERVAL {h:UInt32} HOUR
        ORDER BY ts`,
      query_params: { mint, h: hours },
      format: "JSONEachRow",
    });
    const rows = await rs.json<{ t: number | string; score: number | string }>();
    await client.close();
    return rows.map((r) => ({ t: Number(r.t), score: Number(r.score) }));
  } catch {
    return [];
  }
}

export async function fetchHistories(
  mints: string[],
  hours = 24
): Promise<Record<string, HistoryPoint[]>> {
  const results = await Promise.all(mints.map((m) => fetchHistory(m, hours)));
  const out: Record<string, HistoryPoint[]> = {};
  mints.forEach((m, i) => (out[m] = results[i]));
  return out;
}
