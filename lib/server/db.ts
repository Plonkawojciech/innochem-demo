import { Pool, type PoolClient, type QueryResultRow } from "pg";

const globalDb = globalThis as unknown as { innochemPool?: Pool };
export function database() {
  if (!globalDb.innochemPool) {
    if (!process.env.DATABASE_URL && !process.env.PGHOST)
      throw new Error("Database is not configured");
    globalDb.innochemPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 15000,
      application_name: "innochem-store",
    });
    globalDb.innochemPool.on("error", () =>
      console.error("Database connection error"),
    );
  }
  return globalDb.innochemPool;
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
) {
  return database().query<T>(sql, values);
}
export async function transaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
