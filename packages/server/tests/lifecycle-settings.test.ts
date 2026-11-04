import { describe, it, expect } from 'vitest';
import { adminPool } from '../src/db/pool';

/**
 * Settings → Customer Lifecycle saves four business settings (PUT /customers/lifecycle-config).
 * A business setting needs a definition (foreign key), so each key must be defined or the save fails.
 */
describe('Customer lifecycle settings', () => {
  it('has a definition for every key the lifecycle settings save', async () => {
    const keys = ['lifecycle.enabled', 'lifecycle.at_risk_days', 'lifecycle.churned_days', 'lifecycle.run_time'];
    const { rows } = await adminPool.query('SELECT key FROM sys_configuration_definitions WHERE key = ANY($1)', [keys]);
    expect(rows.map((r) => r.key).sort()).toEqual([...keys].sort());
  });
});
