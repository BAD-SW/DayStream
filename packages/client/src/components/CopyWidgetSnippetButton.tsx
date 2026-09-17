import { useState } from 'react';
import { Button } from '../design-system/components/actions/Button';

interface Props {
  productId: string;
  productName: string;
  action: 'book' | 'purchase';
  /** e.g. a service's online_booking_enabled, or a package/plan's active status. */
  enabled: boolean;
  disabledReason: string;
}

/** Requirement 19 — frontend-only, no backend endpoint: the id/name are already loaded
 * on whichever admin page renders this. The business pastes the copied button as-is and
 * restyles it; they never see or type the underlying DayStream id. */
export function CopyWidgetSnippetButton({ productId, productName, action, enabled, disabledReason }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const snippet = `<button data-daystream-product="${productId}" data-daystream-action="${action}">${productName}</button>`;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (permissions, insecure context) — fail quietly,
      // the button's own label already reverts, nothing else to recover here.
    }
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.25rem' }}>
      <Button variant="outline" size="sm" onClick={handleCopy} disabled={!enabled}>
        {copied ? 'Copied!' : 'Copy widget snippet'}
      </Button>
      {!enabled && (
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #6b7280)' }}>{disabledReason}</span>
      )}
    </div>
  );
}
