/**
 * The application's own dialogs, in place of the browser's alert, confirm and prompt (Phase 44,
 * requirement 3.8): those show a title ("localhost:4000 says") and buttons in the browser's language
 * that the application cannot translate. Each function returns a promise; DialogHost (mounted once at
 * the root of the app) shows the dialogs, one at a time, with the design system's Modal.
 *
 *   if (!(await askConfirm({ message: t('archive.confirm'), confirmLabel: t('archive.do'), destructive: true }))) return;
 *   await showMessage({ message: t('save.failed'), tone: 'error' });
 *   const name = await askText({ message: t('rename.prompt'), defaultValue: current });   // null when cancelled
 */

export interface ConfirmOptions {
  message: string;
  /** Defaults to "Please confirm". */
  title?: string;
  /** Defaults to "Confirm" ("Delete"-style wording is better when the action is destructive). */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** Shows the confirm button in the destructive colour. */
  destructive?: boolean;
}

export interface MessageOptions {
  message: string;
  /** Defaults to "Something went wrong" for 'error', otherwise "Notice". */
  title?: string;
  tone?: 'info' | 'success' | 'error';
  /** Defaults to "OK". */
  okLabel?: string;
}

export interface TextOptions {
  message: string;
  /** Defaults to "Please enter a value". */
  title?: string;
  /** The input's label, shown above it; defaults to the message being the label. */
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  /** Defaults to "OK". */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  multiline?: boolean;
}

export type DialogRequest =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'message'; options: MessageOptions; resolve: () => void }
  | { kind: 'text'; options: TextOptions; resolve: (value: string | null) => void };

type Listener = (request: DialogRequest) => void;
let listener: Listener | null = null;
const waiting: DialogRequest[] = [];

/** Used by DialogHost: receive the requests (and any made before it was mounted). */
export function subscribeDialogs(fn: Listener): () => void {
  listener = fn;
  while (waiting.length) fn(waiting.shift() as DialogRequest);
  return () => { if (listener === fn) listener = null; };
}

function send(request: DialogRequest): void {
  if (listener) listener(request);
  else waiting.push(request);
}

/** Ask the user to confirm; true when they confirm, false when they cancel or close the dialog. */
export function askConfirm(options: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof options === 'string' ? { message: options } : options;
  return new Promise((resolve) => send({ kind: 'confirm', options: opts, resolve }));
}

/** Tell the user something; resolves when they close the dialog. */
export function showMessage(options: MessageOptions | string): Promise<void> {
  const opts = typeof options === 'string' ? { message: options } : options;
  return new Promise((resolve) => send({ kind: 'message', options: opts, resolve }));
}

/** Ask the user for a piece of text; the text, or null when they cancel. */
export function askText(options: TextOptions | string): Promise<string | null> {
  const opts = typeof options === 'string' ? { message: options } : options;
  return new Promise((resolve) => send({ kind: 'text', options: opts, resolve }));
}
