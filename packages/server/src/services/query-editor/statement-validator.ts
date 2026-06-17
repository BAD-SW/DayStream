/**
 * Statement Validator for the Query Editor.
 *
 * Validates SQL statements before execution using a multi-step pipeline:
 * 1. Length check (≤ maxQueryLength)
 * 2. Comment stripping (single-line -- and multi-line /* *​/)
 * 3. Multi-statement detection (semicolons)
 * 4. Normalize whitespace and case
 * 5. Top-level command check (SELECT only, reject SELECT INTO)
 * 6. Blocked keywords check
 * 7. Blocked function calls check
 * 8. System catalog write detection
 */

export interface ValidationResult {
  valid: boolean;
  error?: {
    code: string;
    message: string;
    violatedRule: string;
    rejectedPattern?: string;
  };
}

export interface StatementValidatorConfig {
  maxQueryLength: number;
  blockedFunctions: string[];
}

const DEFAULT_BLOCKED_FUNCTIONS: string[] = [
  'pg_terminate_backend',
  'set_config',
  'lo_import',
  'lo_export',
  'pg_read_file',
  'pg_write_file',
  'dblink_exec',
];

const BLOCKED_KEYWORDS: string[] = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'CREATE',
  'ALTER',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'COPY',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
];

export const DEFAULT_CONFIG: StatementValidatorConfig = {
  maxQueryLength: 10000,
  blockedFunctions: DEFAULT_BLOCKED_FUNCTIONS,
};

/**
 * Strip SQL comments from a statement.
 * Removes single-line (--) and multi-line (/* *​/) comments.
 * Preserves content inside string literals.
 */
export function stripComments(sql: string): string {
  let result = '';
  let i = 0;

  while (i < sql.length) {
    // Single-quoted string literal — preserve as-is
    if (sql[i] === "'") {
      result += sql[i];
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && i + 1 < sql.length && sql[i + 1] === "'") {
          // Escaped single quote
          result += "''";
          i += 2;
        } else if (sql[i] === "'") {
          result += sql[i];
          i++;
          break;
        } else {
          result += sql[i];
          i++;
        }
      }
    }
    // Single-line comment
    else if (sql[i] === '-' && i + 1 < sql.length && sql[i + 1] === '-') {
      // Skip until end of line
      i += 2;
      while (i < sql.length && sql[i] !== '\n') {
        i++;
      }
      // Replace comment with a space to preserve word boundaries
      result += ' ';
    }
    // Multi-line comment
    else if (sql[i] === '/' && i + 1 < sql.length && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length) {
        if (sql[i] === '*' && i + 1 < sql.length && sql[i + 1] === '/') {
          i += 2;
          break;
        }
        i++;
      }
      // Replace comment with a space to preserve word boundaries
      result += ' ';
    }
    // Normal character
    else {
      result += sql[i];
      i++;
    }
  }

  return result;
}

/**
 * Check if the input contains multiple statements separated by semicolons.
 * A trailing semicolon on a single statement is allowed.
 * Semicolons inside string literals are ignored.
 */
function hasMultipleStatements(sql: string): boolean {
  let semicolonCount = 0;
  let i = 0;

  while (i < sql.length) {
    // Skip string literals
    if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && i + 1 < sql.length && sql[i + 1] === "'") {
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          break;
        } else {
          i++;
        }
      }
    } else if (sql[i] === ';') {
      semicolonCount++;
      i++;
    } else {
      i++;
    }
  }

  if (semicolonCount === 0) return false;
  if (semicolonCount === 1) {
    // Allow a single trailing semicolon
    const trimmed = sql.trimEnd();
    return trimmed[trimmed.length - 1] !== ';';
  }
  // More than one semicolon means multiple statements
  return true;
}

/**
 * Normalize whitespace: collapse multiple whitespace characters into single spaces and trim.
 */
function normalizeWhitespace(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

/**
 * Check if the top-level command is SELECT (and not SELECT INTO).
 */
function isAllowedSelectCommand(normalized: string): boolean {
  const upper = normalized.toUpperCase();

  // Must start with SELECT (or parenthesized subquery / WITH CTE)
  if (!upper.startsWith('SELECT') && !upper.startsWith('(') && !upper.startsWith('WITH')) {
    return false;
  }

  // WITH ... SELECT is allowed (Common Table Expressions)
  if (upper.startsWith('WITH')) {
    // Ensure it eventually leads to a SELECT and not an INSERT/UPDATE/DELETE
    // We'll rely on the blocked keywords check for the DML part
    return true;
  }

  // Parenthesized expression — allow it, the blocked keywords check handles any bad content
  if (upper.startsWith('(')) {
    return true;
  }

  // Reject SELECT INTO (which creates a new table)
  if (hasSelectInto(upper)) {
    return false;
  }

  return true;
}

/**
 * Detect SELECT INTO pattern. Must not match INTO within subqueries.
 * Checks for SELECT ... INTO at the top level.
 */
function hasSelectInto(upperSql: string): boolean {
  // Match SELECT ... INTO where INTO is not inside a subquery
  // Strategy: look for INTO keyword after SELECT and before FROM (at top level)
  // A simple approach: check for the INTO keyword at the top level (outside parentheses)
  let depth = 0;
  const tokens = tokenize(upperSql);

  let foundSelect = false;
  for (const token of tokens) {
    if (token === '(') {
      depth++;
    } else if (token === ')') {
      depth--;
    } else if (depth === 0) {
      if (token === 'SELECT') {
        foundSelect = true;
      } else if (foundSelect && token === 'INTO') {
        return true;
      } else if (token === 'FROM') {
        // INTO must come before FROM for SELECT INTO
        foundSelect = false;
      }
    }
  }

  return false;
}

/**
 * Simple tokenizer that splits SQL into words and punctuation,
 * respecting string literals.
 */
function tokenize(sql: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < sql.length) {
    // Skip whitespace
    if (/\s/.test(sql[i])) {
      i++;
      continue;
    }

    // String literal — skip as a single token
    if (sql[i] === "'") {
      let lit = "'";
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && i + 1 < sql.length && sql[i + 1] === "'") {
          lit += "''";
          i += 2;
        } else if (sql[i] === "'") {
          lit += "'";
          i++;
          break;
        } else {
          lit += sql[i];
          i++;
        }
      }
      tokens.push(lit);
      continue;
    }

    // Parentheses and semicolons
    if (sql[i] === '(' || sql[i] === ')' || sql[i] === ';') {
      tokens.push(sql[i]);
      i++;
      continue;
    }

    // Word or operator
    let word = '';
    while (i < sql.length && !/[\s()',;]/.test(sql[i])) {
      word += sql[i];
      i++;
    }
    if (word) {
      tokens.push(word);
    }

    // Skip commas
    if (i < sql.length && sql[i] === ',') {
      tokens.push(',');
      i++;
    }
  }

  return tokens;
}

/**
 * Check for blocked keywords at the top level (outside string literals).
 */
function findBlockedKeyword(normalized: string): string | null {
  const upper = normalized.toUpperCase();
  const tokens = tokenize(upper);

  for (const token of tokens) {
    // Skip string literals
    if (token.startsWith("'")) continue;
    if (BLOCKED_KEYWORDS.includes(token)) {
      return token;
    }
  }

  return null;
}

/**
 * Check for blocked function calls.
 * Looks for function_name( pattern (case-insensitive).
 */
function findBlockedFunction(normalized: string, blockedFunctions: string[]): string | null {
  const lower = normalized.toLowerCase();

  for (const fn of blockedFunctions) {
    const fnLower = fn.toLowerCase();
    // Look for function call pattern: function_name followed by (
    // Use word boundary to avoid matching substrings
    const regex = new RegExp(`\\b${escapeRegex(fnLower)}\\s*\\(`, 'i');
    if (regex.test(lower)) {
      return fn;
    }
  }

  return null;
}

/**
 * Detect writes to system catalog tables.
 * Looks for pg_catalog references or direct manipulation of system tables
 * like pg_authid, pg_roles, pg_database in a modification context.
 */
function hasSystemCatalogWrite(normalized: string): boolean {
  const upper = normalized.toUpperCase();

  // System catalog tables that should never be referenced in modification context
  const systemTables = [
    'PG_AUTHID',
    'PG_ROLES',
    'PG_DATABASE',
    'PG_TABLESPACE',
    'PG_SHADOW',
    'PG_GROUP',
    'PG_USER',
    'PG_SETTINGS',
  ];

  // Check for pg_catalog schema reference in conjunction with blocked keywords
  // e.g., "INSERT INTO pg_catalog.pg_authid"
  const hasPgCatalogRef = /\bPG_CATALOG\s*\./i.test(upper);

  if (hasPgCatalogRef) {
    // If any blocked keyword is present along with pg_catalog, it's a system catalog write
    for (const kw of BLOCKED_KEYWORDS) {
      if (new RegExp(`\\b${kw}\\b`, 'i').test(upper)) {
        return true;
      }
    }
  }

  // Check for direct system table manipulation
  for (const table of systemTables) {
    // Look for patterns like "INTO pg_authid" or "UPDATE pg_authid" etc.
    const tableRegex = new RegExp(`\\b${table}\\b`, 'i');
    if (tableRegex.test(upper)) {
      // If any modification keyword is also present
      for (const kw of BLOCKED_KEYWORDS) {
        if (new RegExp(`\\b${kw}\\b`, 'i').test(upper)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate a SQL statement through the full validation pipeline.
 */
export function validateStatement(
  sql: string,
  config: StatementValidatorConfig = DEFAULT_CONFIG,
): ValidationResult {
  // Step 1: Length check (on raw input)
  if (sql.length > config.maxQueryLength) {
    return {
      valid: false,
      error: {
        code: 'LENGTH_EXCEEDED',
        message: `Query exceeds maximum length of ${config.maxQueryLength} characters`,
        violatedRule: 'LENGTH_EXCEEDED',
      },
    };
  }

  // Step 2: Strip comments
  const stripped = stripComments(sql);

  // Step 3: Multi-statement check (before normalization to preserve semicolons)
  if (hasMultipleStatements(stripped)) {
    return {
      valid: false,
      error: {
        code: 'MULTI_STATEMENT',
        message: 'Only single statements are allowed; multiple statements separated by semicolons are not permitted',
        violatedRule: 'MULTI_STATEMENT',
      },
    };
  }

  // Step 4: Normalize whitespace
  // Remove trailing semicolons for further checks
  let normalized = normalizeWhitespace(stripped);
  if (normalized.endsWith(';')) {
    normalized = normalized.slice(0, -1).trimEnd();
  }

  // Handle empty input after stripping
  if (normalized.length === 0) {
    return {
      valid: false,
      error: {
        code: 'BLOCKED_COMMAND',
        message: 'Empty statement; only SELECT statements are allowed',
        violatedRule: 'BLOCKED_COMMAND',
      },
    };
  }

  // Step 5: Command check — SELECT only, reject SELECT INTO
  if (!isAllowedSelectCommand(normalized)) {
    const upperFirst = normalized.toUpperCase().split(/\s+/)[0];
    return {
      valid: false,
      error: {
        code: 'BLOCKED_COMMAND',
        message: `Statement type '${upperFirst}' is not allowed; only SELECT statements are permitted`,
        violatedRule: 'BLOCKED_COMMAND',
        rejectedPattern: upperFirst === 'SELECT' ? 'SELECT INTO' : upperFirst,
      },
    };
  }

  // Step 6: Blocked keywords check
  const blockedKeyword = findBlockedKeyword(normalized);
  if (blockedKeyword) {
    return {
      valid: false,
      error: {
        code: 'BLOCKED_COMMAND',
        message: `Statement contains blocked keyword '${blockedKeyword}'`,
        violatedRule: 'BLOCKED_COMMAND',
        rejectedPattern: blockedKeyword,
      },
    };
  }

  // Step 7: Blocked function calls
  const blockedFn = findBlockedFunction(normalized, config.blockedFunctions);
  if (blockedFn) {
    return {
      valid: false,
      error: {
        code: 'BLOCKED_FUNCTION',
        message: `Statement contains blocked function '${blockedFn}'`,
        violatedRule: 'BLOCKED_FUNCTION',
        rejectedPattern: blockedFn,
      },
    };
  }

  // Step 8: System catalog write detection
  if (hasSystemCatalogWrite(normalized)) {
    return {
      valid: false,
      error: {
        code: 'SYSTEM_CATALOG',
        message: 'Statement attempts to write to system catalog tables',
        violatedRule: 'SYSTEM_CATALOG',
      },
    };
  }

  return { valid: true };
}
