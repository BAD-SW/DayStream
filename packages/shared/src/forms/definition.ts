// Form definition shared by the form builder (client) and the server (spec 51, gap 1).
// A form is an ordered list of items. A form with an 'agree' and a 'signature' item is a signed form.

export const FORM_ITEM_TYPES = [
  'heading',
  'text',
  'write_in',
  'date',
  'yes_no',
  'single_choice',
  'multi_choice',
  'agree',
  'signature',
] as const;

/** The most columns a checkbox table can have, and the most entries a list can hold. */
export const MAX_FORM_COLUMNS = 4;
export const MAX_FORM_OPTIONS = 200;

/**
 * Lay a list of entries out in columns, filling down each column first (as a printed form reads).
 * Returns one array of entries per column. 7 entries in 3 columns gives rows of 3, so 3 / 3 / 1.
 */
export function entriesByColumn<T>(entries: readonly T[], columns: number): T[][] {
  const cols = Math.max(1, Math.min(MAX_FORM_COLUMNS, Math.floor(columns) || 1));
  const perColumn = Math.ceil(entries.length / cols) || 1;
  const out: T[][] = [];
  for (let c = 0; c < cols; c++) {
    const slice = entries.slice(c * perColumn, (c + 1) * perColumn);
    if (slice.length > 0) out.push(slice);
  }
  return out;
}

export type FormItemType = (typeof FORM_ITEM_TYPES)[number];

export type FormItem =
  | { id: string; type: 'heading'; text: string }
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'write_in' | 'date' | 'yes_no'; label: string; required: boolean }
  | { id: string; type: 'single_choice'; label: string; required: boolean; options: string[] }
  // A table of tick boxes: the entries flow down each column and across `columns` columns.
  | { id: string; type: 'multi_choice'; label: string; required: boolean; options: string[]; columns?: number }
  | { id: string; type: 'agree'; label: string }
  | { id: string; type: 'signature'; label: string };

export interface FormDefinition {
  items: FormItem[];
}

/** When a form is needed (design 1.8). */
export interface FormApplies {
  first_visit?: boolean;
  service_ids?: string[];
}

/** An answer submitted for one item: text, 'yes'/'no', date (YYYY-MM-DD), choice(s), or agree = true. */
export type FormAnswer = string | string[] | boolean;

const QUESTION_TYPES: ReadonlySet<string> = new Set([
  'write_in', 'date', 'yes_no', 'single_choice', 'multi_choice',
]);

export interface FormValidationIssue {
  itemId: string | null;
  message: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Validates a form definition. Returns an empty list when it is valid. */
export function validateFormDefinition(input: unknown, kind: 'form' | 'chart' = 'form'): FormValidationIssue[] {
  const issues: FormValidationIssue[] = [];
  if (!isRecord(input) || !Array.isArray(input.items)) {
    return [{ itemId: null, message: 'The form must have a list of items.' }];
  }
  if (input.items.length === 0) {
    return [{ itemId: null, message: 'Add at least one item to the form.' }];
  }

  const seen = new Set<string>();
  let agree = 0;
  let signature = 0;

  for (const raw of input.items as unknown[]) {
    if (!isRecord(raw)) {
      issues.push({ itemId: null, message: 'Every item must be an object.' });
      continue;
    }
    const id = typeof raw.id === 'string' ? raw.id : '';
    const type = raw.type;
    if (!id) {
      issues.push({ itemId: null, message: 'Every item needs an id.' });
      continue;
    }
    if (seen.has(id)) issues.push({ itemId: id, message: 'Item ids must be unique.' });
    seen.add(id);

    if (typeof type !== 'string' || !(FORM_ITEM_TYPES as readonly string[]).includes(type)) {
      issues.push({ itemId: id, message: `Unknown item type "${String(type)}".` });
      continue;
    }

    if (type === 'heading' || type === 'text') {
      if (!nonEmpty(raw.text)) issues.push({ itemId: id, message: 'This item needs text.' });
      continue;
    }

    if (!nonEmpty(raw.label)) issues.push({ itemId: id, message: 'This item needs a label.' });

    if (QUESTION_TYPES.has(type) && typeof raw.required !== 'boolean') {
      issues.push({ itemId: id, message: 'This question must say whether it is required.' });
    }

    if (type === 'single_choice' || type === 'multi_choice') {
      const options = Array.isArray(raw.options) ? raw.options : [];
      const filled = options.filter(nonEmpty);
      if (filled.length < 2 || filled.length !== options.length) {
        issues.push({ itemId: id, message: 'A choice needs at least two options, none of them empty.' });
      } else if (new Set(filled.map((o) => o.trim().toLowerCase())).size !== filled.length) {
        issues.push({ itemId: id, message: 'Options must be different from each other.' });
      } else if (filled.length > MAX_FORM_OPTIONS) {
        issues.push({ itemId: id, message: `A list can have at most ${MAX_FORM_OPTIONS} entries.` });
      }
    }

    if (type === 'multi_choice' && raw.columns !== undefined) {
      const c = raw.columns;
      if (typeof c !== 'number' || !Number.isInteger(c) || c < 1 || c > MAX_FORM_COLUMNS) {
        issues.push({ itemId: id, message: `Columns must be a whole number from 1 to ${MAX_FORM_COLUMNS}.` });
      }
    }

    if (type === 'agree') agree += 1;
    if (type === 'signature') signature += 1;
  }

  if (kind === 'chart' && (agree > 0 || signature > 0)) {
    issues.push({ itemId: null, message: 'A chart is signed off by the practitioner, so it cannot have an "I agree" box or a signature line.' });
    return issues;
  }
  if (agree > 1) issues.push({ itemId: null, message: 'A form can have only one "I agree" box.' });
  if (signature > 1) issues.push({ itemId: null, message: 'A form can have only one signature line.' });
  if (agree !== signature) {
    issues.push({ itemId: null, message: 'A signed form needs both an "I agree" box and a signature line.' });
  }
  return issues;
}

/** True when the form has an "I agree" box and a signature line. */
export function isSignedForm(def: FormDefinition): boolean {
  return def.items.some((i) => i.type === 'agree') && def.items.some((i) => i.type === 'signature');
}

/**
 * Checks submitted answers against a (valid) definition: required questions answered,
 * choices from the options, and for a signed form the agree box ticked. The signature
 * image itself is checked by the server. Returns issues keyed by item id.
 */
export function validateFormAnswers(
  def: FormDefinition,
  answers: Record<string, FormAnswer | undefined>,
): FormValidationIssue[] {
  const issues: FormValidationIssue[] = [];
  for (const item of def.items) {
    const a = answers[item.id];
    switch (item.type) {
      case 'write_in':
      case 'date':
      case 'yes_no': {
        const empty = typeof a !== 'string' || a.trim() === '';
        if (empty) {
          if (item.required) issues.push({ itemId: item.id, message: 'Required.' });
        } else if (item.type === 'yes_no' && a !== 'yes' && a !== 'no') {
          issues.push({ itemId: item.id, message: 'Choose yes or no.' });
        } else if (item.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(a)) {
          issues.push({ itemId: item.id, message: 'Enter a valid date.' });
        }
        break;
      }
      case 'single_choice': {
        if (typeof a !== 'string' || a === '') {
          if (item.required) issues.push({ itemId: item.id, message: 'Required.' });
        } else if (!item.options.includes(a)) {
          issues.push({ itemId: item.id, message: 'Choose one of the options.' });
        }
        break;
      }
      case 'multi_choice': {
        const list = Array.isArray(a) ? a : [];
        if (list.length === 0) {
          if (item.required) issues.push({ itemId: item.id, message: 'Required.' });
        } else if (list.some((v) => !item.options.includes(v))) {
          issues.push({ itemId: item.id, message: 'Choose from the options.' });
        }
        break;
      }
      case 'agree':
        if (a !== true) issues.push({ itemId: item.id, message: 'You must agree to continue.' });
        break;
      default:
        break;
    }
  }
  return issues;
}
