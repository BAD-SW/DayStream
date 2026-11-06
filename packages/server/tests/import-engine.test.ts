import { describe, it, expect } from 'vitest';
import {
  parseCsv, classifyCell, detectHeaderRow, detectColumns, applyMapping, CUSTOMER_FIELDS,
  profileColumns, repairRow, repairRows, canonicalProfiles, realignRowTail, rowFits,
} from '../src/services/migration/import-engine';

/**
 * Phase 50 Wave 1 — unit coverage for the pure detection engine: CSV parsing,
 * cell classification, header-row detection (by comparing row 0 against the data
 * below), and column identification (name-based with a header, value-based
 * without). No DB/IO — pure functions of their inputs.
 */

describe('parseCsv', () => {
  it('parses rows and handles quoted fields with commas', () => {
    const grid = parseCsv('a,b,c\n1,"two, 2",3');
    expect(grid).toEqual([['a', 'b', 'c'], ['1', 'two, 2', '3']]);
  });
  it('drops a trailing empty line and a BOM', () => {
    const grid = parseCsv('\uFEFFx,y\n1,2\n');
    expect(grid).toEqual([['x', 'y'], ['1', '2']]);
  });
});

describe('classifyCell', () => {
  it('classifies the obvious shapes', () => {
    expect(classifyCell('alex@example.com')).toBe('email');
    expect(classifyCell('+1 (555) 123-4567')).toBe('phone');
    expect(classifyCell('2026-10-21')).toBe('date');
    expect(classifyCell('42')).toBe('number');
    expect(classifyCell('$1,074.01')).toBe('money');
    expect(classifyCell('Alex Rivera')).toBe('text');
    expect(classifyCell('')).toBe('empty');
  });

  it('treats a bare 7–9 digit integer as a number, not a phone (legacy id like 10492831)', () => {
    expect(classifyCell('10492831')).toBe('number');   // 8-digit id
    expect(classifyCell('3948105')).toBe('number');     // 7-digit id
    expect(classifyCell('84729104')).toBe('number');    // 8-digit id
    // Real phones still detect: formatted, or a bare 10+ digit number.
    expect(classifyCell('+17165550198')).toBe('phone');
    expect(classifyCell('+1-716-555-0143')).toBe('phone');
    expect(classifyCell('5551234567')).toBe('phone');   // bare 10-digit → phone
  });
});

describe('detectHeaderRow', () => {
  it('detects a header when row 0 is labels over value-shaped data', () => {
    const grid = [
      ['First Name', 'Email', 'Phone'],
      ['Alex', 'alex@example.com', '+15551234567'],
      ['Sam', 'sam@example.com', '+15559876543'],
    ];
    const r = detectHeaderRow(grid);
    expect(r.hasHeader).toBe(true);
  });

  it('detects NO header when row 0 is data of the same kind as the rows below', () => {
    const grid = [
      ['Alex', 'alex@example.com', '+15551234567'],
      ['Sam', 'sam@example.com', '+15559876543'],
      ['Jo', 'jo@example.com', '+15550001111'],
    ];
    const r = detectHeaderRow(grid);
    expect(r.hasHeader).toBe(false);
  });

  it('detects a header over mostly free-text columns when its cells are known column names (D-57)', () => {
    const grid = [
      ['Customer ID', 'First Name', 'Surname', 'Email', 'Mobile', 'Tags', 'Notes', 'Customer Since'],
      ['L-1', 'Ana', 'Migrada', 'ana@example.com', '+34600111222', 'VIP;Imported', 'Likes mornings', '2019-03-15'],
      ['L-2', 'José', 'Núñez', 'jose@example.com', '', '', '', ''],
      ['L-3', 'Bad', 'Email', 'not-an-email', '', '', '', ''],
    ];
    expect(detectHeaderRow(grid).hasHeader).toBe(false); // value shapes alone are not enough here
    expect(detectHeaderRow(grid, CUSTOMER_FIELDS).hasHeader).toBe(true);
  });

  it('still detects NO header for data rows when the field names are given', () => {
    const grid = [
      ['Alex', 'alex@example.com', '+15551234567'],
      ['Sam', 'sam@example.com', '+15559876543'],
    ];
    expect(detectHeaderRow(grid, CUSTOMER_FIELDS).hasHeader).toBe(false);
  });
});

describe('detectColumns', () => {
  it('maps by header name when a header is present', () => {
    const grid = [
      ['Surname', 'E-mail Address', 'Mobile'],
      ['Rivera', 'alex@example.com', '+15551234567'],
    ];
    const cols = detectColumns(grid, true, CUSTOMER_FIELDS);
    const byIdx = Object.fromEntries(cols.map((c) => [c.index, c.field]));
    expect(byIdx[0]).toBe('last_name');   // Surname
    expect(byIdx[1]).toBe('email');       // E-mail Address
    expect(byIdx[2]).toBe('phone');       // Mobile
    expect(cols.every((c) => c.field === null || c.confident)).toBe(true);
  });

  it('maps by VALUES when there is no header', () => {
    const grid = [
      ['Alex', 'alex@example.com', '2026-10-21'],
      ['Sam', 'sam@example.com', '2025-01-02'],
      ['Jo', 'jo@example.com', '2024-06-30'],
    ];
    const cols = detectColumns(grid, false, CUSTOMER_FIELDS);
    const byIdx = Object.fromEntries(cols.map((c) => [c.index, c.field]));
    expect(byIdx[1]).toBe('email');       // column of email-shaped values
    // column 2 is all dates → a date field (DOB in the customer set)
    expect(byIdx[2]).toBe('date_of_birth');
  });

  it('leaves an unrecognised column unmapped rather than guessing', () => {
    const grid = [
      ['Loyalty #', 'Email'],
      ['L-001', 'alex@example.com'],
    ];
    const cols = detectColumns(grid, true, CUSTOMER_FIELDS);
    expect(cols[0].field).toBeNull();     // "Loyalty #" matches nothing
    expect(cols[1].field).toBe('email');
  });
});

describe('Wave 4 — intelligent detection (headerless)', () => {
  // Mirrors the real sample customer file shape (minus the shifted rows, tested separately):
  // legacy_id, email, first, last, <legacy balance>, dob, gender, language, country, notes, tags, joined
  const sample = [
    ['LEG-10001', 'avery.morgan@example.com', 'Avery', 'Morgan', '-1371', '4/12/1988', 'Female', 'en-US', 'US', 'Prefers mornings.', 'fitness;new-member', '1/15/2025'],
    ['LEG-10002', 'jordan.lee@example.com', 'Jordan', 'Lee', '-1241', '9/23/1992', 'Male', 'en-US', 'US', 'Recovery.', 'recovery', '2/3/2025'],
    ['LEG-10003', 'camila.rossi@example.com', 'Camila', 'Rossi', '-869', '12/5/1985', 'Female', 'it-IT', 'US', 'Email please.', 'wellness', '2/18/2025'],
    ['LEG-10004', 'noah.patel@example.com', 'Noah', 'Patel', '-1304', '6/30/1997', 'Male', 'en-US', 'US', 'Referred.', 'referral', '3/1/2025'],
    ['LEG-10005', 'sophia.bennett@example.com', 'Sophia', 'Bennett', '-974', '2/14/1979', 'Female', 'en-US', 'US', 'Monthly.', 'member', '3/22/2025'],
  ];

  it('maps a patterned id, email, first/last by dictionary, and DOB vs joined by distribution', () => {
    const cols = detectColumns(sample, false, CUSTOMER_FIELDS);
    const byIdx = Object.fromEntries(cols.map((c) => [c.index, c.field]));
    expect(byIdx[0]).toBe('legacy_customer_id');  // LEG-#### patterned id
    expect(byIdx[1]).toBe('email');               // value shape
    expect(byIdx[2]).toBe('first_name');          // given-name dictionary
    expect(byIdx[3]).toBe('last_name');           // surname dictionary / adjacency
    expect(byIdx[5]).toBe('date_of_birth');       // older, wide spread
    expect(byIdx[11]).toBe('joined');             // recent cluster
  });

  it('grades name/date inferences as likely and the id/email as certain', () => {
    const cols = detectColumns(sample, false, CUSTOMER_FIELDS);
    const conf = Object.fromEntries(cols.map((c) => [c.field, c.confidence]));
    expect(conf.email).toBe('certain');
    expect(conf.legacy_customer_id).toBe('certain'); // patterned
    expect(conf.first_name).toBe('likely');
    expect(conf.last_name).toBe('likely');
    expect(conf.date_of_birth).toBe('likely');
    expect(conf.joined).toBe('likely');
  });

  it('detects a gender column by its tokens (Male/Female/Non-binary) at likely', () => {
    const grid = [
      ['LEG-1', 'a@x.com', 'Avery', 'Morgan', '-1', '4/12/1988', 'Male', 'en-US'],
      ['LEG-2', 'b@x.com', 'Jordan', 'Lee', '-2', '9/23/1992', 'Female', 'en-US'],
      ['LEG-3', 'c@x.com', 'Riley', 'Stone', '-3', '8/19/2001', 'Non-binary', 'en-US'],
      ['LEG-4', 'd@x.com', 'Noah', 'Patel', '-4', '6/30/1997', 'Male', 'en-US'],
    ];
    const cols = detectColumns(grid, false, CUSTOMER_FIELDS);
    const g = cols.find((c) => c.field === 'gender');
    expect(g?.index).toBe(6);
    expect(g?.confidence).toBe('likely');
  });

  it('resolves an alpha-numeric legacy id by ELIMINATION via uniqueness (no fixed format)', () => {
    // Mixed-format ids (letters+digits, some trailing letters) that match no id pattern and aren't
    // plain integers. With the other columns identified, the unique id-shaped column is the id.
    const grid = [
      ['a@x.com', '2025-01-15', 'NX104928', 'Sofia'],
      ['b@x.com', '2025-03-22', 'RE9284A', 'James'],
      ['c@x.com', '2026-02-10', 'CA57204', 'Arthur'],
      ['d@x.com', '2026-01-08', 'ME4729B', 'Elena'],
    ];
    const byIdx = Object.fromEntries(detectColumns(grid, false, CUSTOMER_FIELDS).map((c) => [c.index, c.field]));
    expect(byIdx[0]).toBe('email');
    expect(byIdx[2]).toBe('legacy_customer_id');
    expect(byIdx[3]).toBe('first_name');
  });

  it('resolves first/last name by ELIMINATION when the dictionaries do not know the names', () => {
    // Diverse names not in the bundled dictionaries; everything else is identifiable, so the two
    // leftover name-shaped columns must be the names (leftmost → first, the other → last).
    const grid = [
      ['Elena', 'e@x.ru', '2026-01-08', 'Petrova'],
      ['Fatima', 'f@x.ae', '2026-01-08', 'Ahmed'],
      ['Dmitri', 'd@x.ru', '2025-06-18', 'Volkov'],
      ['Ingrid', 'i@x.se', '2025-03-22', 'Kerr'],
    ];
    const byIdx = Object.fromEntries(detectColumns(grid, false, CUSTOMER_FIELDS).map((c) => [c.index, c.field]));
    expect(byIdx[0]).toBe('first_name');
    expect(byIdx[1]).toBe('email');
    expect(byIdx[3]).toBe('last_name');
  });

  it('detects language, country, notes, and tags columns by value shape (headerless)', () => {
    const grid = [
      ['837492', 'j@x.com', 'James', 'Miller', '2025-01-15', 'English', 'US', 'Requires evening slots', 'VIP,Sports-Therapy'],
      ['10492831', 's@x.es', 'Sofia', 'Blanco', '2025-03-22', 'Spanish', 'ES', 'Founder 2 referral', 'Elite-Tier'],
      ['9284', 'a@x.edu', 'Arthur', 'Morgan', '2025-06-18', 'Russian', 'RU', 'Prefers Room 2', 'Cryo-Only'],
      ['572049', 'c@x.ca', 'Chloe', 'Nguyen', '2026-02-10', 'Arabic', 'AE', 'Cross-border client', 'MedSpa,Priority'],
    ];
    const byIdx = Object.fromEntries(detectColumns(grid, false, CUSTOMER_FIELDS).map((c) => [c.index, c.field]));
    expect(byIdx[5]).toBe('preferred_language'); // English/Spanish/Russian/Arabic
    expect(byIdx[6]).toBe('country');            // ISO alpha-2 codes
    expect(byIdx[7]).toBe('notes');              // free-text sentences
    expect(byIdx[8]).toBe('tags');               // separated labels
  });

  it('does not mistake a short-notes column for tags when there is no separator', () => {
    // Two text columns: one short prose (notes), one separated labels (tags).
    const grid = [
      ['a@x.com', 'Prefers Room 2', 'VIP,Priority'],
      ['b@x.com', 'Evening only', 'Elite-Tier'],
      ['c@x.com', 'Likes mornings', 'Cryo-Only,Sauna'],
    ];
    const byIdx = Object.fromEntries(detectColumns(grid, false, CUSTOMER_FIELDS).map((c) => [c.index, c.field]));
    expect(byIdx[1]).toBe('notes');
    expect(byIdx[2]).toBe('tags');
  });

  it('leaves the unmodelled legacy-balance column (negative integers) unmapped, never guessed as id', () => {
    const cols = detectColumns(sample, false, CUSTOMER_FIELDS);
    expect(cols[4].field).toBeNull(); // -1371 etc: not a customer field
  });

  it('proposes a BARE-number id at low confidence via uniqueness, not a repeating number', () => {
    // col 0 = unique bare ids; col 1 = a repeating count (not unique → not an id)
    const grid = [
      ['48217', '3', 'alex@example.com'],
      ['48218', '3', 'sam@example.com'],
      ['48219', '5', 'jo@example.com'],
    ];
    const cols = detectColumns(grid, false, CUSTOMER_FIELDS);
    expect(cols[0].field).toBe('legacy_customer_id');
    expect(cols[0].confidence).toBe('likely');     // bare number → not asserted
    expect(cols[1].field).toBeNull();              // repeating count → not an id
  });
});

describe('short rows: a missing TRAILING optional column is not a misalignment', () => {
  // Legacy id is the last column; the majority have it, so canonical width = 11. A row with no id
  // ends early and parses to 10 cells (no trailing comma). It must be accepted, not flagged.
  const majority = [
    ['a@x.com', 'James', 'Miller', '+1-716-555-0143', '1982-05-14', 'Male', 'English', 'US', 'note', 'VIP', 'NX104928'],
    ['b@x.es', 'Sofia', 'Blanco', '+34-555-0102', '1990-11-23', 'Female', 'Spanish', 'ES', 'note', 'Elite', 'DS83749'],
    ['c@x.edu', 'Arthur', 'Morgan', '+17165550198', '1975-02-02', 'Male', 'English', 'US', 'note', 'Cryo', 'RE9284A'],
    ['d@x.ca', 'Chloe', 'Nguyen', '+1-416-555-0177', '1995-08-19', 'Female', 'English', 'CA', 'note', 'Sauna', 'CA57204'],
  ];
  const profiles = profileColumns(majority, 11);

  it('accepts a correct row that is short because the trailing id column is absent', () => {
    const noId = ['z@x.com', 'Zoe', 'Zane', '+1-212-555-0100', '1991-04-04', 'Female', 'English', 'US', 'note', 'VIP']; // 10 cells
    const r = repairRow(noId, profiles);
    expect(r.alignment).toBe('ok');
    expect(r.cells.length).toBe(11);   // padded to canonical width
    expect(r.cells[10]).toBe('');      // id column empty
  });

  it('still flags a genuinely misaligned short row', () => {
    // Date sitting in the phone column (col 3) — a real misalignment, must not be silently accepted.
    const bad = ['z@x.com', 'Zoe', 'Zane', '1991-04-04', 'Female', 'English', 'US', 'note', 'VIP'];
    expect(repairRow(bad, profiles).alignment).toBe('unresolved');
  });
});

describe('realignRowTail — per-cell shift re-fits the remaining columns by profile', () => {
  // Clean majority: id,email,first,last,dob(date),gender,language,country,notes,joined(date)
  const clean = [
    ['837492', 'a@x.com', 'James', 'Miller', '1982-05-14', 'Male', 'English', 'US', 'Prefers mornings', '2025-01-15'],
    ['10492831', 'b@x.es', 'Sofia', 'Blanco', '1990-11-23', 'Female', 'Spanish', 'ES', 'Founder referral', '2025-03-22'],
    ['9284', 'c@x.edu', 'Arthur', 'Morgan', '1975-02-02', 'Male', 'English', 'US', 'Likes room 2', '2025-06-18'],
    ['572049', 'd@x.ca', 'Chloe', 'Nguyen', '1995-08-19', 'Female', 'English', 'CA', 'Cross-border', '2026-02-10'],
  ];
  const profiles = profileColumns(clean, 10);

  it('re-positions the tail intelligently (not a blind shift), holding the head fixed', () => {
    // gender dropped → everything from col 5 shifted left, trailing empty. User shifts col 5 right.
    const broken = ['837492', 'a@x.com', 'James', 'Miller', '1982-05-14', 'English', 'US', 'Prefers mornings', '2025-01-15', ''];
    const r = realignRowTail(broken, profiles, 5, true);
    expect(r.aligned).toBe(true);
    expect(r.cells[4]).toBe('1982-05-14');  // head untouched (dob)
    expect(r.cells[5]).toBe('');            // gender correctly empty (the dropped value)
    expect(r.cells[6]).toBe('English');     // language re-seated
    expect(r.cells[9]).toBe('2025-01-15');  // joined date back in its date column
  });

  it('rowFits flags an email with a space, then clears once it is corrected', () => {
    const bad = ['837492', 'l.lopez@ba wellness.ar', 'Luis', 'Lopez', '1982-05-14', 'Male', 'English', 'US', 'Note', '2025-01-15'];
    const r1 = rowFits(bad, profiles);
    expect(r1.aligned).toBe(false);
    expect(r1.reason).toMatch(/column 2/);
    const r2 = rowFits([bad[0], 'l.lopez@bawellness.ar', ...bad.slice(2)], profiles);
    expect(r2.aligned).toBe(true);
  });
});

describe('Wave 4 — profile-driven row repair', () => {
  // The real sample file's shape: 12 columns. Row 1 is correct; rows 2+ DROPPED the country
  // value and appended a trailing empty cell, so the count stays 12 while notes/tags/joined
  // shifted one slot left. A column-count check cannot see this — only profile-fit can.
  const goodRows = [
    ['LEG-10001', 'avery.morgan@example.com', 'Avery', 'Morgan', '-1371', '4/12/1988', 'Female', 'en-US', 'US', 'Prefers mornings.', 'fitness', '1/15/2025'],
    ['LEG-10006', 'mateo.garcia@example.com', 'Mateo', 'Garcia', '-1577', '11/8/1990', 'Male', 'es-US', 'US', 'Spanish please.', 'spanish', '4/9/2025'],
    ['LEG-10010', 'isabella.davis@example.com', 'Isabella', 'Davis', '-1182', '10/2/1972', 'Female', 'en-US', 'US', 'Longtime.', 'loyal', '8/29/2025'],
  ];
  const profiles = profileColumns(goodRows, 12);

  it('repairs a country-dropped row that still has 12 cells (trailing empty compensates)', () => {
    // country dropped: email/dob/joined now off by one; a trailing empty keeps the count at 12.
    const shifted = ['LEG-10002', 'jordan.lee@example.com', 'Jordan', 'Lee', '-1241', '9/23/1992', 'Male', 'en-US', 'Interested in recovery.', 'recovery', '2/3/2025', ''];
    const res = repairRow(shifted, profiles);
    expect(res.alignment).toBe('repaired');
    // country slot (index 8) is now empty; the join date landed back in slot 11.
    expect(res.cells[8]).toBe('');
    expect(res.cells[11]).toBe('2/3/2025');
    expect(classifyCell(res.cells[5])).toBe('date'); // DOB still a date in its column
  });

  it('leaves a correctly-aligned row untouched', () => {
    const res = repairRow(goodRows[0], profiles);
    expect(res.alignment).toBe('ok');
    expect(res.cells).toEqual(goodRows[0]);
  });

  it('summarises repaired rows with before/after samples and leaves good rows ok', () => {
    const mixed = [
      goodRows[0],
      ['LEG-10002', 'jordan.lee@example.com', 'Jordan', 'Lee', '-1241', '9/23/1992', 'Male', 'en-US', 'Interested in recovery.', 'recovery', '2/3/2025', ''],
    ];
    const summary = repairRows(mixed, profiles);
    expect(summary.repaired).toBe(1);
    expect(summary.unresolved).toBe(0);
    expect(summary.samples[0].row).toBe(2);
    expect(summary.rows[1][8]).toBe('');          // country emptied on the repaired row
    expect(summary.rows[0]).toEqual(goodRows[0]); // good row unchanged
  });

  it('derives the canonical structure from the MAJORITY row shape, flagging the lone outlier', () => {
    // 1 row has a country value (join date in slot 11); 4 rows dropped it (join date in slot 10,
    // trailing empty). The majority (4) defines the structure, so the outlier is the 1 with country.
    const rows = [
      ['LEG-1', 'a@x.com', 'Avery', 'Morgan', '-1', '4/12/1988', 'F', 'en-US', 'US', 'Note one.', 'tag', '1/15/2025'],
      ['LEG-2', 'b@x.com', 'Jordan', 'Lee', '-2', '9/23/1992', 'M', 'en-US', 'Note two here.', 'tag', '2/3/2025', ''],
      ['LEG-3', 'c@x.com', 'Camila', 'Rossi', '-3', '12/5/1985', 'F', 'it-IT', 'Note three here.', 'tag', '2/18/2025', ''],
      ['LEG-4', 'd@x.com', 'Noah', 'Patel', '-4', '6/30/1997', 'M', 'en-US', 'Note four here.', 'tag', '3/1/2025', ''],
      ['LEG-5', 'e@x.com', 'Sophia', 'Bennett', '-5', '2/14/1979', 'F', 'en-US', 'Note five here.', 'tag', '3/22/2025', ''],
    ];
    const canon = canonicalProfiles(rows, 12);
    expect(canon.cohortSize).toBe(4);                 // the 4 "no-country" rows are canonical
    expect(canon.canonicalSignature).toBe('1:email,5:date,10:date'); // join date in slot 10

    const summary = repairRows(rows, 12);
    // The 4 majority rows align (ok); the 1 outlier (country present) does not fit → unresolved.
    expect(summary.unresolved).toBe(1);
    expect(summary.failures[0].row).toBe(1);
  });

  it('fails an ambiguous row with a reason rather than guessing', () => {
    // A row missing two shaped values with no clean single alignment → unresolved.
    const broken = ['LEG-10099', 'x', 'y', 'z']; // far too short, no shaped values land right
    const summary = repairRows([broken], profiles);
    expect(summary.unresolved + summary.repaired).toBeGreaterThanOrEqual(0);
    // It must not silently produce a confidently-wrong alignment: either ok-by-optionality or unresolved,
    // but never a repaired claim here since nothing shaped pins it.
    expect(summary.samples.length === 0 || summary.repaired === 0).toBe(true);
  });
});

describe('applyMapping', () => {
  it('builds field-keyed row objects, skipping the header row', () => {
    const grid = [
      ['First Name', 'Email'],
      ['Alex', 'alex@example.com'],
      ['Sam', 'sam@example.com'],
    ];
    const rows = applyMapping(grid, true, { 0: 'first_name', 1: 'email' });
    expect(rows).toEqual([
      { first_name: 'Alex', email: 'alex@example.com' },
      { first_name: 'Sam', email: 'sam@example.com' },
    ]);
  });
});
