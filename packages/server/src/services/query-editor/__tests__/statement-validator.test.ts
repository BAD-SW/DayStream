import { describe, it, expect } from 'vitest';
import {
  validateStatement,
  stripComments,
  DEFAULT_CONFIG,
  StatementValidatorConfig,
} from '../statement-validator';

describe('StatementValidator', () => {
  describe('stripComments', () => {
    it('removes single-line comments', () => {
      const sql = "SELECT 1 -- this is a comment\nFROM foo";
      expect(stripComments(sql)).toBe("SELECT 1  \nFROM foo");
    });

    it('removes multi-line comments', () => {
      const sql = "SELECT /* hidden */ 1 FROM foo";
      // The comment is replaced with a space; surrounding spaces preserved
      expect(stripComments(sql)).toContain('SELECT');
      expect(stripComments(sql)).toContain('1 FROM foo');
      expect(stripComments(sql)).not.toContain('hidden');
    });

    it('removes multi-line comments without surrounding spaces', () => {
      const sql = "SELECT/*hidden*/1 FROM foo";
      expect(stripComments(sql)).toBe("SELECT 1 FROM foo");
    });

    it('preserves content inside string literals', () => {
      const sql = "SELECT '-- not a comment' FROM foo";
      expect(stripComments(sql)).toBe("SELECT '-- not a comment' FROM foo");
    });

    it('handles nested-looking multi-line comments', () => {
      const sql = "SELECT /* outer /* inner */ 1 FROM foo";
      // Comment ends at first */ — "outer /* inner" is the comment
      expect(stripComments(sql)).toContain('SELECT');
      expect(stripComments(sql)).toContain('1 FROM foo');
      expect(stripComments(sql)).not.toContain('outer');
      expect(stripComments(sql)).not.toContain('inner');
    });

    it('handles escaped quotes in strings', () => {
      const sql = "SELECT 'it''s fine' FROM foo";
      expect(stripComments(sql)).toBe("SELECT 'it''s fine' FROM foo");
    });
  });

  describe('Length validation', () => {
    it('accepts queries within length limit', () => {
      const sql = 'SELECT 1';
      const result = validateStatement(sql);
      expect(result.valid).toBe(true);
    });

    it('accepts queries at exactly the max length', () => {
      const sql = 'SELECT ' + 'x'.repeat(10000 - 7);
      expect(sql.length).toBe(10000);
      const result = validateStatement(sql);
      // This will fail on command check since it's not valid SQL, but not on length
      expect(result.error?.code).not.toBe('LENGTH_EXCEEDED');
    });

    it('rejects queries exceeding max length', () => {
      const sql = 'SELECT ' + 'x'.repeat(10001);
      const result = validateStatement(sql);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('LENGTH_EXCEEDED');
      expect(result.error?.violatedRule).toBe('LENGTH_EXCEEDED');
    });

    it('respects custom maxQueryLength', () => {
      const config: StatementValidatorConfig = { ...DEFAULT_CONFIG, maxQueryLength: 50 };
      const sql = 'SELECT ' + 'x'.repeat(50);
      const result = validateStatement(sql, config);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('LENGTH_EXCEEDED');
    });
  });

  describe('Multi-statement detection', () => {
    it('rejects multiple statements separated by semicolons', () => {
      const sql = 'SELECT 1; SELECT 2';
      const result = validateStatement(sql);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('MULTI_STATEMENT');
      expect(result.error?.violatedRule).toBe('MULTI_STATEMENT');
    });

    it('allows a single trailing semicolon', () => {
      const sql = 'SELECT 1;';
      const result = validateStatement(sql);
      expect(result.valid).toBe(true);
    });

    it('rejects semicolons in the middle even with trailing', () => {
      const sql = 'SELECT 1; SELECT 2;';
      const result = validateStatement(sql);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('MULTI_STATEMENT');
    });

    it('ignores semicolons inside string literals', () => {
      const sql = "SELECT 'a;b' FROM foo";
      const result = validateStatement(sql);
      expect(result.valid).toBe(true);
    });
  });

  describe('SELECT-only command check', () => {
    it('accepts plain SELECT statements', () => {
      const result = validateStatement('SELECT id, name FROM users');
      expect(result.valid).toBe(true);
    });

    it('accepts SELECT with WHERE clause', () => {
      const result = validateStatement("SELECT * FROM users WHERE name = 'test'");
      expect(result.valid).toBe(true);
    });

    it('accepts SELECT with JOIN', () => {
      const result = validateStatement('SELECT u.id FROM users u JOIN orders o ON u.id = o.user_id');
      expect(result.valid).toBe(true);
    });

    it('accepts WITH (CTE) followed by SELECT', () => {
      const result = validateStatement('WITH cte AS (SELECT 1) SELECT * FROM cte');
      expect(result.valid).toBe(true);
    });

    it('rejects SELECT INTO', () => {
      const result = validateStatement('SELECT * INTO new_table FROM users');
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_COMMAND');
      expect(result.error?.rejectedPattern).toBe('SELECT INTO');
    });

    it('rejects SELECT ... INTO (with columns)', () => {
      const result = validateStatement('SELECT id, name INTO backup_table FROM users');
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_COMMAND');
    });

    it('rejects non-SELECT top-level commands', () => {
      const commands = ['INSERT INTO foo VALUES (1)', 'UPDATE foo SET x=1', 'DELETE FROM foo'];
      for (const sql of commands) {
        const result = validateStatement(sql);
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('BLOCKED_COMMAND');
      }
    });
  });

  describe('Blocked keywords', () => {
    const blockedKeywords = [
      'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER',
      'TRUNCATE', 'GRANT', 'REVOKE', 'COPY', 'BEGIN', 'COMMIT',
      'ROLLBACK', 'SAVEPOINT',
    ];

    it.each(blockedKeywords)('rejects statements containing %s keyword', (keyword) => {
      // Embed the blocked keyword in a seemingly valid SELECT
      const sql = `SELECT * FROM (${keyword} foo) AS t`;
      const result = validateStatement(sql);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_COMMAND');
    });

    it('performs case-insensitive matching', () => {
      const result = validateStatement('select * from (insert foo) as t');
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_COMMAND');
    });

    it('does not reject keywords inside string literals', () => {
      const result = validateStatement("SELECT 'INSERT' FROM foo");
      expect(result.valid).toBe(true);
    });
  });

  describe('Blocked function calls', () => {
    it('rejects pg_terminate_backend', () => {
      const result = validateStatement('SELECT pg_terminate_backend(123)');
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_FUNCTION');
      expect(result.error?.rejectedPattern).toBe('pg_terminate_backend');
    });

    it('rejects set_config', () => {
      const result = validateStatement("SELECT set_config('app.tenant', '123', false)");
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_FUNCTION');
      expect(result.error?.rejectedPattern).toBe('set_config');
    });

    it('rejects lo_import', () => {
      const result = validateStatement("SELECT lo_import('/etc/passwd')");
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_FUNCTION');
    });

    it('rejects lo_export', () => {
      const result = validateStatement("SELECT lo_export(12345, '/tmp/out')");
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_FUNCTION');
    });

    it('rejects pg_read_file', () => {
      const result = validateStatement("SELECT pg_read_file('/etc/hosts')");
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_FUNCTION');
    });

    it('rejects pg_write_file', () => {
      const result = validateStatement("SELECT pg_write_file('/tmp/x', 'data')");
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_FUNCTION');
    });

    it('rejects dblink_exec', () => {
      const result = validateStatement("SELECT dblink_exec('conn', 'DELETE FROM foo')");
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_FUNCTION');
    });

    it('performs case-insensitive function matching', () => {
      const result = validateStatement('SELECT PG_TERMINATE_BACKEND(123)');
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_FUNCTION');
    });

    it('rejects functions with spaces before parenthesis', () => {
      const result = validateStatement('SELECT pg_terminate_backend (123)');
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_FUNCTION');
    });

    it('accepts custom blocklist', () => {
      const config: StatementValidatorConfig = {
        ...DEFAULT_CONFIG,
        blockedFunctions: ['my_dangerous_func'],
      };
      const result = validateStatement('SELECT my_dangerous_func()', config);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_FUNCTION');
      expect(result.error?.rejectedPattern).toBe('my_dangerous_func');
    });

    it('allows non-blocked functions', () => {
      const result = validateStatement('SELECT count(*), lower(name) FROM users');
      expect(result.valid).toBe(true);
    });
  });

  describe('System catalog write detection', () => {
    it('rejects writes to pg_catalog schema', () => {
      const result = validateStatement('SELECT * FROM (INSERT INTO pg_catalog.pg_authid VALUES (1)) AS t');
      expect(result.valid).toBe(false);
    });

    it('rejects manipulation of pg_authid', () => {
      const result = validateStatement('SELECT * FROM (UPDATE pg_authid SET rolsuper = true) AS t');
      expect(result.valid).toBe(false);
    });

    it('rejects manipulation of pg_roles', () => {
      const result = validateStatement('SELECT * FROM (DELETE FROM pg_roles) AS t');
      expect(result.valid).toBe(false);
    });

    it('allows reading from system catalog tables', () => {
      const result = validateStatement('SELECT * FROM pg_roles');
      expect(result.valid).toBe(true);
    });

    it('allows reading from pg_catalog schema', () => {
      const result = validateStatement('SELECT * FROM pg_catalog.pg_tables');
      expect(result.valid).toBe(true);
    });
  });

  describe('Case-insensitive matching', () => {
    it('validates SELECT regardless of case', () => {
      expect(validateStatement('select 1').valid).toBe(true);
      expect(validateStatement('SELECT 1').valid).toBe(true);
      expect(validateStatement('SeLeCt 1').valid).toBe(true);
    });

    it('blocks keywords regardless of case', () => {
      const result = validateStatement('SELECT * FROM (drop TABLE foo) AS t');
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_COMMAND');
    });
  });

  describe('Comment obfuscation prevention', () => {
    it('detects blocked keywords hidden in single-line comments', () => {
      // The comment is stripped, revealing the blocked keyword after it
      const sql = "SELECT 1; -- harmless\nDELETE FROM users";
      const result = validateStatement(sql);
      expect(result.valid).toBe(false);
    });

    it('detects blocked keywords hidden around multi-line comments', () => {
      const sql = "SELECT * FROM (/* sneaky */ DROP TABLE foo) AS t";
      const result = validateStatement(sql);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('BLOCKED_COMMAND');
    });

    it('strips comments before multi-statement check', () => {
      const sql = "SELECT 1 /* ; */ ; SELECT 2";
      const result = validateStatement(sql);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('MULTI_STATEMENT');
    });
  });

  describe('Error response structure', () => {
    it('returns violatedRule for all rejection types', () => {
      const cases = [
        { sql: 'x'.repeat(10001), expectedRule: 'LENGTH_EXCEEDED' },
        { sql: 'SELECT 1; SELECT 2', expectedRule: 'MULTI_STATEMENT' },
        { sql: 'DROP TABLE foo', expectedRule: 'BLOCKED_COMMAND' },
        { sql: 'SELECT pg_terminate_backend(1)', expectedRule: 'BLOCKED_FUNCTION' },
      ];

      for (const { sql, expectedRule } of cases) {
        const result = validateStatement(sql);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error?.violatedRule).toBe(expectedRule);
        expect(result.error?.message).toBeTruthy();
        expect(result.error?.code).toBeTruthy();
      }
    });

    it('returns valid: true with no error for valid statements', () => {
      const result = validateStatement('SELECT 1');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });
});
