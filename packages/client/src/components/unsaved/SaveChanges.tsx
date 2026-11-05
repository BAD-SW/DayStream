import { useEffect, useState } from 'react';
import { Button } from '../../design-system/components/actions/Button';
import { useDraftSections } from './DraftSections';

/**
 * The page's one Save (David, 2026-10-28): "You have unsaved changes." while anything is
 * unsaved, the outcome of the last save, and the Save changes button. Put it in the page
 * header's actions, inside a DraftSectionsProvider.
 */
export function SaveChanges() {
  const { dirtySections, saveAll, saving } = useDraftSections();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = dirtySections.length > 0;
  useEffect(() => { setResult((r) => (dirty ? (r?.ok ? null : r) : (r && !r.ok ? null : r))); }, [dirty]);
  const save = async () => {
    const { failed } = await saveAll();
    setResult(failed.length ? { ok: false, text: `Not saved: ${failed.map((f) => `${f.label} (${f.error})`).join('; ')}` } : { ok: true, text: 'All changes saved.' });
  };
  return (
    <>
      {/* A failed save says what was not saved, even while those changes are still unsaved. */}
      {dirty && !(result && !result.ok) ? <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-warning-dark)' }}>You have unsaved changes.</span>
        : result && <span role={result.ok ? 'status' : 'alert'} style={{ fontSize: 'var(--font-size-sm)', color: result.ok ? 'var(--color-success)' : 'var(--color-error)' }}>{result.text}</span>}
      <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>Save changes</Button>
    </>
  );
}
