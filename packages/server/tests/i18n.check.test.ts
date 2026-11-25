/**
 * Phase 44 checks for the server (requirement 7; design section 9), run with the tests.
 *
 *  1. Untranslated phrases: listed for each language and written to i18n-missing.<language>.txt (not failed).
 *  2. Fill-ins: a translation whose {{fill-ins}} differ from its English phrase fails.
 *  3. Messages typed into the code: a message for tenant, business or customer users that is not taken
 *     from the translation files (msg('errors:…')) fails. Checked: text passed to new …Error(…),
 *     json({ error: … }) and error(res, …). src/i18n/scope.json lists the English-only files (the
 *     System persona's) and the files not converted yet; a file on the second list must still have typed
 *     messages, so the list only gets shorter, and every new file is checked from the start.
 *
 * A literal that must stay as it is (a log-only message) is marked with `// i18n-ignore` on its line or
 * the line above.
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

const SERVER = path.resolve(__dirname, '..');
const SRC = path.join(SERVER, 'src');
const LOCALES = path.join(SRC, 'i18n', 'locales');
const SCOPE_FILE = path.join(SRC, 'i18n', 'scope.json');
const CHECKED_DIRS = ['routes', 'services', 'middleware', 'auth'];

const read = (file: string): TranslationBundle => JSON.parse(fs.readFileSync(file, 'utf8')) as TranslationBundle;
const rel = (file: string) => path.relative(SRC, file).replace(/\\/g, '/');

describe('server translation files', () => {
  const namespaces = fs.readdirSync(path.join(LOCALES, DEFAULT_LANGUAGE)).filter((f) => f.endsWith('.json'));
  const others = (TRANSLATED_LANGUAGES as readonly string[]).filter((l) => l !== DEFAULT_LANGUAGE);

  it.each(others)('%s: reports untranslated phrases and keeps every fill-in', (language) => {
    const missing: string[] = [];
    const mismatched: string[] = [];
    for (const name of namespaces) {
      const english = read(path.join(LOCALES, DEFAULT_LANGUAGE, name));
      const file = path.join(LOCALES, language, name);
      const problems = compareBundles(english, fs.existsSync(file) ? read(file) : {}, languageLocale(language));
      const ns = name.slice(0, -5);
      missing.push(...problems.missing.map((k) => `${ns}:${k}`));
      mismatched.push(...problems.mismatched.map((m) => `${ns}:${m.key}  English "${m.english}"  ${language} "${m.translated}"`));
    }
    fs.writeFileSync(path.join(SERVER, `i18n-missing.${language}.txt`), missing.join('\n') + (missing.length ? '\n' : ''));
    if (missing.length) console.info(`[i18n] ${language}: ${missing.length} server phrase(s) not translated yet (i18n-missing.${language}.txt)`);
    expect(mismatched, 'translations whose fill-ins differ from English').toEqual([]);
  });
});

interface Finding { line: number; text: string }
const HAS_WORD = /[A-Za-z]{2,}/;

function findTypedMessages(file: string): Finding[] {
  const source = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = source.split(/\r?\n/);
  const found: Finding[] = [];
  const literalText = (e: ts.Expression | undefined): string | null => {
    if (!e) return null;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((s) => s.literal.text).join(' ');
    return null;
  };
  const add = (node: ts.Node, text: string | null) => {
    if (text === null || !HAS_WORD.test(text)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    if (/i18n-ignore/.test(lines[line] ?? '') || /i18n-ignore/.test(lines[line - 1] ?? '')) return;
    found.push({ line: line + 1, text: text.slice(0, 80) });
  };
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && /Error$/.test(node.expression.getText(sf))) add(node, literalText(node.arguments?.[0]));
    else if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (callee === 'error' && node.arguments.length >= 2) add(node, literalText(node.arguments[1]));
      if (/\.json$/.test(callee) && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        for (const p of node.arguments[0].properties) {
          if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'error') add(p, literalText(p.initializer));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function codeFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...codeFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

interface Scope { englishOnly: string[]; notConvertedYet: string[] }

describe('messages typed into the server code', () => {
  it('every message for tenant, business and customer users comes from the translation files', () => {
    const scope = JSON.parse(fs.readFileSync(SCOPE_FILE, 'utf8')) as Scope;
    const englishOnly = new Set(scope.englishOnly);
    const findings = new Map<string, Finding[]>();
    for (const dir of CHECKED_DIRS) {
      for (const file of codeFiles(path.join(SRC, dir))) {
        const f = findTypedMessages(file);
        if (f.length) findings.set(rel(file), f);
      }
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

    expect(unexpected, 'messages typed into the code: use msg() and add the phrase to the English translation file').toEqual([]);
    expect(converted, 'converted: remove these from notConvertedYet in src/i18n/scope.json').toEqual([]);
    expect(gone, 'files in src/i18n/scope.json that no longer exist').toEqual([]);
  });
});
