import { AsyncLocalStorage } from 'async_hooks';
import { adminPool } from '../../../db/pool';

/**
 * Database access for report definitions. While a report runs, its queries go through one
 * connection whose time zone is the business's, so `timestamp::date`, CURRENT_DATE and
 * date_trunc() mean the business's day. (They meant the database server's day: on a server
 * in UTC a sale at 00:30 in Madrid was reported on the previous day.)
 */
type Result = { rows: any[]; rowCount: number | null };
const current = new AsyncLocalStorage<{ query: (text: string, params?: any[]) => Promise<Result> }>();

export const reportDb = {
  query(text: string, params?: any[]): Promise<Result> {
    return (current.getStore() || adminPool).query(text, params) as Promise<Result>;
  },
};

export async function onBusinessClock<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
  const { rows } = await adminPool.query('SELECT timezone FROM sys_businesses WHERE id = $1', [businessId]);
  const timeZone = rows[0]?.timezone;
  if (!timeZone) return fn();
  const client = await adminPool.connect();
  try {
    await client.query("SELECT set_config('TimeZone', $1, false)", [timeZone]);
    return await current.run(client, fn);
  } finally {
    await client.query('RESET TIME ZONE').catch(() => undefined);
    client.release();
  }
}
