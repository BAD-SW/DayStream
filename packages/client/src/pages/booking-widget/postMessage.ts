/**
 * All cross-origin communication with the parent page goes through window.parent.postMessage
 * (Requirement 13.1) — never cookies, localStorage, or URL state. targetOrigin is '*' because
 * the iframe has no reliable way to know the embedding business's domain in advance; the actual
 * security boundary is enforced on the RECEIVING end (daystream-widget.js validates e.origin
 * against its own known APP_ORIGIN before acting on anything). No message payload here carries
 * anything sensitive (no tokens, no PII beyond what the business already owns via the booking).
 *
 * A no-op when opened directly in a browser tab (window.parent === window, as in the Phase 2
 * checkpoint) rather than embedded in the Widget_Script's iframe.
 */
export function sendToParent(type: string, payload: Record<string, unknown> = {}): void {
  if (window.parent === window) return;
  window.parent.postMessage({ type, ...payload }, '*');
}
