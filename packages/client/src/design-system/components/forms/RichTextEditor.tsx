import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

/**
 * A small, dependency-free rich-text editor for document body content.
 *
 * Scope is deliberately constrained to formatting that survives BOTH email and
 * PDF rendering: bold, italic, underline, bullet/numbered lists, and a couple of
 * semantic heading sizes. We intentionally do NOT expose arbitrary font family
 * or pixel font sizes — the business's brand/theme owns typography, and free
 * fonts break in email clients. The value is a constrained HTML subset.
 *
 * Content is held in a contentEditable surface. On every change we read innerHTML,
 * run it through a whitelist sanitizer (allowed tags only, no attributes), and
 * hand the clean HTML to the parent. That keeps the XSS surface minimal without
 * pulling in a sanitizer dependency.
 */

/** Tags we keep. Everything else is unwrapped; all attributes are stripped. */
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'H3', 'H4', 'UL', 'OL', 'LI', 'P', 'BR', 'DIV', 'SPAN']);

/**
 * Whitelist-sanitize an HTML fragment: drop disallowed elements (keeping their
 * text), and remove every attribute (so no style/onclick/href can ride along).
 */
export function sanitizeRichText(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstChild as HTMLElement | null;
  if (!root) return '';

  const walk = (node: Node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        walk(el);
        if (!ALLOWED_TAGS.has(el.tagName)) {
          // Unwrap: replace the element with its children.
          while (el.firstChild) node.insertBefore(el.firstChild, el);
          node.removeChild(el);
        } else {
          // Strip every attribute.
          for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
        }
      }
    }
  };
  walk(root);
  return root.innerHTML;
}

export interface RichTextEditorHandle {
  /** Insert plain text at the current caret (used by placeholder chips). */
  insertText: (text: string) => void;
  /** Focus the editable surface. */
  focus: () => void;
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  onFocus?: () => void;
  ariaLabel?: string;
  minHeight?: number;
}

type Command = { cmd: string; arg?: string; label: string; title: string };

const TOOLBAR: Command[] = [
  { cmd: 'bold', label: 'B', title: 'Bold' },
  { cmd: 'italic', label: 'I', title: 'Italic' },
  { cmd: 'underline', label: 'U', title: 'Underline' },
  { cmd: 'formatBlock', arg: 'H3', label: 'Heading', title: 'Heading' },
  { cmd: 'formatBlock', arg: 'H4', label: 'Subheading', title: 'Subheading' },
  { cmd: 'formatBlock', arg: 'P', label: 'Normal', title: 'Normal text' },
  { cmd: 'insertUnorderedList', label: '• List', title: 'Bulleted list' },
  { cmd: 'insertOrderedList', label: '1. List', title: 'Numbered list' },
  { cmd: 'removeFormat', label: 'Clear', title: 'Clear formatting' },
];

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor({ value, onChange, onFocus, ariaLabel, minHeight = 180 }, ref) {
    const editableRef = useRef<HTMLDivElement>(null);

    // Keep the DOM in sync when the value changes from outside (e.g. loading a
    // template), but never while the user is typing in this field (that would
    // reset the caret). We compare against current innerHTML to decide.
    useEffect(() => {
      const el = editableRef.current;
      if (el && el.innerHTML !== value) {
        el.innerHTML = value;
      }
    }, [value]);

    const emit = useCallback(() => {
      const el = editableRef.current;
      if (el) onChange(sanitizeRichText(el.innerHTML));
    }, [onChange]);

    const exec = (c: Command) => {
      editableRef.current?.focus();
      // execCommand is deprecated but still the only cross-browser, dependency-free
      // way to format a contentEditable region; acceptable for this constrained set.
      document.execCommand(c.cmd, false, c.arg);
      emit();
    };

    useImperativeHandle(ref, () => ({
      insertText: (text: string) => {
        editableRef.current?.focus();
        document.execCommand('insertText', false, text);
        emit();
      },
      focus: () => editableRef.current?.focus(),
    }), [emit]);

    return (
      <div style={styles.wrap}>
        <div style={styles.toolbar} role="toolbar" aria-label="Text formatting">
          {TOOLBAR.map((c) => (
            <button
              key={c.label}
              type="button"
              title={c.title}
              aria-label={c.title}
              style={styles.toolBtn}
              // Use onMouseDown + preventDefault so the editor keeps its selection.
              onMouseDown={(e) => { e.preventDefault(); exec(c); }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div
          ref={editableRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          style={{ ...styles.editable, minHeight }}
          onInput={emit}
          onBlur={emit}
          onFocus={onFocus}
        />
      </div>
    );
  },
);

const styles: Record<string, React.CSSProperties> = {
  wrap: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', background: 'var(--color-surface)', overflow: 'hidden' },
  toolbar: { display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '6px 8px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-background)' },
  toolBtn: { padding: '4px 8px', fontSize: 'var(--font-size-xs)', fontWeight: 600, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm, 4px)', background: 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-family)', minHeight: '28px' },
  editable: { padding: '10px 12px', fontSize: 'var(--font-size-base)', color: 'var(--color-text)', fontFamily: 'var(--font-family)', lineHeight: 1.5, outline: 'none', overflowY: 'auto' },
};
