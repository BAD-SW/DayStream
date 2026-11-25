/**
 * Phase 44 checks for the web app (requirement 7; design section 9), run with the tests.
 *
 *  1. Untranslated phrases: listed for each language and written to i18n-missing.<language>.txt (not failed).
 *  2. Fill-ins and numbered tags: a translation that differs from its English phrase fails.
 *  3. Text typed into screens: a tenant, business or customer screen showing text not taken from the
 *     translation files fails. src/i18n/scope.json lists the English-only files (the System persona's)
 *     and the files not converted yet; a file on the second list must still have typed text, so the
 *     list only gets shorter, and every new file is checked from the start.
 *
 * A literal that must stay as it is (a code sample, a format pattern) is marked with `// i18n-ignore`
 * on its line or the line above.
 *
 * To rebuild the not-converted list (only when the check is first introduced):
 *   I18N_WRITE_SCOPE=1 npx vitest run tests/i18n.check.test.ts
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { TRANSLATED_LANGUAGES, DEFAULT_LANGUAGE, compareBundles, languageLocale } from '@daystream/shared';
import type { TranslationBundle } from '@daystream/shared';

const CLIENT = path.resolve(__dirname, '..');
const SRC = path.join(CLIENT, 'src');
const LOCALES = path.join(SRC, 'i18n', 'locales');
const SCOPE_FILE = path.join(SRC, 'i18n', 'scope.json');

const read = (file: string): TranslationBundle => JSON.parse(fs.readFileSync(file, 'utf8')) as TranslationBundle;
const rel = (file: string) => path.relative(SRC, file).replace(/\\/g, '/');

// ─── 1 and 2: translation files ──────────────────────────────────────────────

describe('translation files', () => {
  const namespaces = fs.readdirSync(path.join(LOCALES, DEFAULT_LANGUAGE)).filter((f) => f.endsWith('.json'));
  const others = (TRANSLATED_LANGUAGES as readonly string[]).filter((l) => l !== DEFAULT_LANGUAGE);

  it.each(others)('%s: reports untranslated phrases and keeps every fill-in', (language) => {
    const missing: string[] = [];
    const mismatched: string[] = [];
    for (const name of namespaces) {
      const english = read(path.join(LOCALES, DEFAULT_LANGUAGE, name));
      const file = path.join(LOCALES, language, name);
      const translated = fs.existsSync(file) ? read(file) : {};
      const problems = compareBundles(english, translated, languageLocale(language));
      const ns = name.slice(0, -5);
      missing.push(...problems.missing.map((k) => `${ns}:${k}`));
      mismatched.push(...problems.mismatched.map((m) => `${ns}:${m.key}  English "${m.english}"  ${language} "${m.translated}"`));
    }
    fs.writeFileSync(path.join(CLIENT, `i18n-missing.${language}.txt`), missing.join('\n') + (missing.length ? '\n' : ''));
    if (missing.length) console.info(`[i18n] ${language}: ${missing.length} phrase(s) not translated yet (i18n-missing.${language}.txt)`);
    expect(mismatched, 'translations whose fill-ins or tags differ from English').toEqual([]);
  });
});

// ─── 3: text typed into screens ──────────────────────────────────────────────

/** Attributes whose text is shown or read out. */
const TEXT_ATTRIBUTES = new Set([
  'placeholder', 'title', 'alt', 'aria-label', 'aria-description', 'aria-placeholder', 'aria-valuetext',
  'label', 'helper', 'helperText', 'description', 'emptyMessage', 'emptyText', 'confirmText', 'confirmLabel',
  'cancelText', 'cancelLabel', 'subtitle', 'heading', 'tooltip', 'message', 'errorMessage', 'successMessage',
]);
/** Functions whose first argument is shown. */
const TEXT_CALLS = new Set(['alert', 'confirm', 'prompt']);
const HAS_WORD = /[A-Za-z]{2,}/;
/** Object properties whose text is shown (labels of menu items, columns, options, steps). */
const TEXT_PROPERTIES = new Set([...TEXT_ATTRIBUTES, 'text', 'header', 'headerName', 'emptyLabel', 'buttonLabel', 'hint']);
/** A translation key (`table.noRows`, `nav:modules.customers.title`), not text. */
const LOOKS_LIKE_KEY = /^(([\w-]+:)?[\w-]+(\.[\w-]+)+|var\(--[\w-]+\).*|https?:\/\/\S+)$/;

interface Finding { line: number; text: string }

function findTypedText(file: string): Finding[] {
  const source = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = source.split(/\r?\n/);
  const ignored = (pos: number) => {
    const line = sf.getLineAndCharacterOfPosition(pos).line;
    return /i18n-ignore/.test(lines[line] ?? '') || /i18n-ignore/.test(lines[line - 1] ?? '');
  };
  const found: Finding[] = [];
  const add = (node: ts.Node, text: string) => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!HAS_WORD.test(t) || LOOKS_LIKE_KEY.test(t) || ignored(node.getStart(sf))) return;
    found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: t.slice(0, 80) });
  };
  const literalText = (e: ts.Expression | undefined): string | null => {
    if (!e) return null;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((s) => s.literal.text).join(' ');
    return null;
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add(node, node.text);
    else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText(sf))) {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) add(init, init.text);
      else if (init && ts.isJsxExpression(init)) {
        const text = literalText(init.expression);
        if (text !== null) add(init, text);
      }
    } else if (ts.isPropertyAssignment(node) && TEXT_PROPERTIES.has(node.name.getText(sf).replace(/['"]/g, ''))) {
      const text = literalText(node.initializer);
      if (text !== null) add(node.initializer, text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf).replace(/^window\./, '');
      if (TEXT_CALLS.has(callee)) {
        const text = literalText(node.arguments[0]);
        if (text !== null) add(node, text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function screenFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'i18n' && entry.name !== '__tests__') out.push(...screenFiles(full)); }
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|stories|d)\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

// ─── 4: every key used has an English phrase (else the screen shows the key) ─

/** The English keys of every namespace. */
function englishKeys(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const name of fs.readdirSync(path.join(LOCALES, DEFAULT_LANGUAGE)).filter((f) => f.endsWith('.json'))) {
    const bundle = JSON.parse(fs.readFileSync(path.join(LOCALES, DEFAULT_LANGUAGE, name), 'utf8').replace(/^\uFEFF/, '')) as TranslationBundle;
    out.set(name.slice(0, -5), new Set(Object.keys(bundle)));
  }
  return out;
}

/** Literal keys passed to a translation function, with their namespace, that have no English phrase. */
function missingKeys(file: string, english: Map<string, Set<string>>): string[] {
  const source = fs.readFileSync(file, 'utf8');
  if (!/useTranslation|i18n\.t\(|getFixedT/.test(source)) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  // Translation functions and their namespaces: const { t } = useTranslation('ns'), const { t: tc } = …, getFixedT(null, 'ns').
  const fns = new Map<string, string>([['t', 'common']]);
  const nsArg = (call: ts.CallExpression, index: number): string | null => {
    const a = call.arguments[index];
    if (a && ts.isStringLiteral(a)) return a.text;
    if (a && ts.isArrayLiteralExpression(a) && a.elements[0] && ts.isStringLiteral(a.elements[0])) return a.elements[0].text;
    return null;
  };
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)) {
      const callee = node.initializer.expression.getText(sf);
      const ns = callee === 'useTranslation' ? nsArg(node.initializer, 0) ?? 'common' : /getFixedT$/.test(callee) ? nsArg(node.initializer, 1) ?? 'common' : null;
      if (ns !== null) {
        if (ts.isObjectBindingPattern(node.name)) {
          for (const el of node.name.elements) {
            const prop = (el.propertyName ?? el.name).getText(sf);
            if (prop === 't') fns.set(el.name.getText(sf), ns);
          }
        } else if (ts.isIdentifier(node.name) && /getFixedT$/.test(callee)) fns.set(node.name.text, ns);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  const missing = new Set<string>();
  const has = (ns: string, key: string) => {
    const keys = english.get(ns);
    return !!keys && (keys.has(key) || keys.has(`${key}_other`) || keys.has(`${key}_one`));
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments[0] && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) {
      const callee = node.expression.getText(sf);
      const fnNs = callee === 'i18n.t' ? 'common' : fns.get(callee);
      if (fnNs !== undefined) {
        let key = node.arguments[0].text;
        let ns = fnNs;
        let hasDefault = false;
        const opts = node.arguments[1];
        if (opts && ts.isObjectLiteralExpression(opts)) {
          for (const p of opts.properties) {
            if (!ts.isPropertyAssignment(p)) continue;
            const name = p.name.getText(sf);
            if (name === 'ns' && ts.isStringLiteral(p.initializer)) ns = p.initializer.text;
            if (name === 'defaultValue') hasDefault = true;
          }
        }
        const i = key.indexOf(':');
        if (i > 0) { ns = key.slice(0, i); key = key.slice(i + 1); }
        if (!hasDefault && !has(ns, key)) missing.add(`${ns}:${key}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...missing];
}

// ─── 5: no browser dialogs (requirement 3.8) ─────────────────────────────────

/** Calls to the browser's alert, confirm and prompt (window.alert(…) or alert(…)). */
function browserDialogs(file: string): Finding[] {
  const source = fs.readFileSync(file, 'utf8');
  if (!/\b(alert|confirm|prompt)\s*\(/.test(source)) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = source.split(/\r?\n/);
  const found: Finding[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf).replace(/^(window|globalThis)\./, '');
      if (TEXT_CALLS.has(callee)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
        if (!/i18n-ignore/.test(lines[line] ?? '') && !/i18n-ignore/.test(lines[line - 1] ?? '')) {
          found.push({ line: line + 1, text: node.getText(sf).slice(0, 60) });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('dialogs', () => {
  it('uses the application\'s dialogs (askConfirm, showMessage, askText), never the browser\'s alert, confirm or prompt', () => {
    // Every screen, the System persona's too (their text stays English, but in the application's dialog).
    const problems: string[] = [];
    for (const file of screenFiles(SRC)) {
      const f = browserDialogs(file);
      if (f.length) problems.push(`${rel(file)}: ${f.map((x) => `line ${x.line}`).join(', ')}`);
    }
    expect(problems, 'browser dialogs: use askConfirm / showMessage / askText from design-system/components/feedback/dialogs').toEqual([]);
  }, 60000);
});

describe('keys used in the code', () => {
  it('every key a screen uses has an English phrase', () => {
    const english = englishKeys();
    const problems: string[] = [];
    for (const file of screenFiles(SRC)) {
      const m = missingKeys(file, english);
      if (m.length) problems.push(`${rel(file)}: ${m.slice(0, 6).join(', ')}${m.length > 6 ? ` (+${m.length - 6} more)` : ''}`);
    }
    expect(problems, 'keys with no English phrase (the screen would show the key): add them to the English translation file').toEqual([]);
  }, 60000);
});

interface Scope { englishOnly: string[]; notConvertedYet: string[] }

describe('text typed into screens', () => {
  it('every tenant, business and customer screen takes its text from the translation files', () => {
    const scope = JSON.parse(fs.readFileSync(SCOPE_FILE, 'utf8')) as Scope;
    const englishOnly = new Set(scope.englishOnly);
    const findings = new Map<string, Finding[]>();
    for (const file of screenFiles(SRC)) {
      const f = findTypedText(file);
      if (f.length) findings.set(rel(file), f);
    }

    if (process.env.I18N_WRITE_SCOPE === '1') {
      const notConvertedYet = [...findings.keys()].filter((f) => !englishOnly.has(f)).sort();
      fs.writeFileSync(SCOPE_FILE, JSON.stringify({ ...scope, notConvertedYet }, null, 2) + '\n');
      return;
    }

    const notConverted = new Set(scope.notConvertedYet);
    const unexpected = [...findings.entries()]
      .filter(([file]) => !englishOnly.has(file) && !notConverted.has(file))
      .map(([file, f]) => `${file}: ${f.slice(0, 5).map((x) => `line ${x.line} "${x.text}"`).join('; ')}${f.length > 5 ? ` (+${f.length - 5} more)` : ''}`);
    const converted = scope.notConvertedYet.filter((file) => !findings.has(file));
    const gone = [...scope.englishOnly, ...scope.notConvertedYet].filter((file) => !fs.existsSync(path.join(SRC, file)));

    expect(unexpected, 'screens with text typed into them: use t() and add the phrase to the English translation file').toEqual([]);
    expect(converted, 'converted: remove these from notConvertedYet in src/i18n/scope.json').toEqual([]);
    expect(gone, 'files in src/i18n/scope.json that no longer exist').toEqual([]);
  }, 60000);   // reads every source file
});
