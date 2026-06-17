import { useRef, useEffect, useCallback } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { sql, StandardSQL } from '@codemirror/lang-sql';
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { SchemaTable } from '@daystream/shared';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
  schema?: SchemaTable[];
  disabled?: boolean;
}

/**
 * CodeEditor wraps CodeMirror 6 with SQL language mode, auto-completion,
 * and keyboard shortcuts for query execution.
 */
export function CodeEditor({ value, onChange, onExecute, schema, disabled }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);

  // Keep refs updated
  onChangeRef.current = onChange;
  onExecuteRef.current = onExecute;

  const schemaCompletionSource = useCallback(
    (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/[\w.]+/);
      if (!word && !context.explicit) return null;

      const options: { label: string; type: string; detail?: string }[] = [];

      if (schema) {
        for (const table of schema) {
          options.push({
            label: table.tableName,
            type: 'class',
            detail: 'table',
          });
          for (const col of table.columns) {
            options.push({
              label: col.columnName,
              type: 'property',
              detail: `${col.dataType}${col.isNullable ? ' (nullable)' : ''}`,
            });
            // Qualified column: table.column
            options.push({
              label: `${table.tableName}.${col.columnName}`,
              type: 'property',
              detail: `${col.dataType}${col.isNullable ? ' (nullable)' : ''}`,
            });
          }
        }
      }

      return {
        from: word ? word.from : context.pos,
        options,
        validFor: /^[\w.]*$/,
      };
    },
    [schema]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const executeKeymap = keymap.of([
      {
        key: 'Ctrl-Enter',
        run: () => {
          onExecuteRef.current();
          return true;
        },
      },
      {
        key: 'Cmd-Enter',
        run: () => {
          onExecuteRef.current();
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newValue = update.state.doc.toString();
        onChangeRef.current(newValue);
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        sql({ dialect: StandardSQL }),
        autocompletion({
          override: [schemaCompletionSource],
        }),
        executeKeymap,
        updateListener,
        EditorState.readOnly.of(!!disabled),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '14px',
          },
          '.cm-scroller': {
            overflow: 'auto',
          },
          '.cm-content': {
            fontFamily: 'monospace',
          },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, schemaCompletionSource]);

  // Sync external value changes into the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentValue = view.state.doc.toString();
    if (currentValue !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentValue.length,
          insert: value,
        },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      style={styles.container}
      data-testid="code-editor"
    />
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    width: '100%',
    border: '1px solid var(--color-border, #333)',
    borderRadius: '4px',
    overflow: 'hidden',
  },
};
