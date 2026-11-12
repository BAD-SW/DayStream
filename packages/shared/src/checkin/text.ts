import { DEFAULT_LANGUAGE, isSupportedLanguage } from '../constants/supported';
import type { SupportedLanguage } from '../constants/supported';

/**
 * The words on the screens a customer sees when they check in (spec 51, gap 3): the phone page, the
 * front-desk kiosk and the list of forms. Nothing on those screens is written into the page.
 *
 * Every supported language has a complete set of default wording below, so a business that has written
 * nothing still gets correct screens in the customer's language. TypeScript will not compile until a newly
 * supported language has its set, the same rule as the language list itself. A business can replace any
 * of the wording, per language, in Business Setup > Templates > Check-In.
 *
 * `{{first_name}}`, `{{service_name}}`, `{{time}}` and `{{business_name}}` are filled in with the customer's own details where a
 * piece of wording offers them.
 */
export const CHECK_IN_TEXT_KEYS = [
  'loading', 'greeting', 'checkInButton', 'checkingIn', 'checkedIn', 'ready', 'started', 'cannotCheckIn',
  'formsLabel', 'formsAllDone', 'formsOne', 'formsMany', 'formDone', 'formRedo', 'formTodo', 'formFill', 'formOpening',
  'kioskWelcome', 'kioskPrompt', 'kioskInputLabel', 'kioskSubmit', 'kioskWelcomeName', 'kioskCheckedIn',
  'kioskAlreadyCheckedIn', 'kioskFormsTodo', 'kioskAllSet', 'kioskDone', 'kioskBack',
  'kioskNothingToday', 'kioskNothingTodayOne', 'kioskNothingTodayMany', 'kioskNothingTodayHelp',
  'kioskOffTitle', 'kioskOffBody', 'kioskNotSetUpTitle', 'kioskNotSetUpBody',
  'readyEmailSubject', 'checkInFailed', 'formFailed',
] as const;
export type CheckInTextKey = (typeof CHECK_IN_TEXT_KEYS)[number];
export type CheckInText = Record<CheckInTextKey, string>;

/** One piece of wording a business can change. */
export interface CheckInTextField {
  key: CheckInTextKey;
  label: string;
  group: 'Phone page' | 'Forms list' | 'Kiosk';
  /** Details that can be written into this wording as `{{name}}`. */
  placeholders?: ('first_name' | 'service_name' | 'time' | 'business_name')[];
}

/** The details that can be written into wording as `{{name}}`, for the editor's placeholder chips. */
export const CHECK_IN_TEXT_PLACEHOLDERS: { token: 'first_name' | 'service_name' | 'time' | 'business_name'; label: string; description: string; sample: string }[] = [
  { token: 'first_name', label: 'First Name', description: "The customer's first name.", sample: 'Ana' },
  { token: 'service_name', label: 'Service', description: 'The booked service.', sample: 'Private Gym Access' },
  { token: 'time', label: 'Appointment Time', description: 'The start time of the appointment.', sample: '2:30 PM' },
  { token: 'business_name', label: 'Business Name', description: 'The name of your business.', sample: 'Transcend Health' },
];
/** The wording a business may edit, in the order the editor shows it. The kiosk "not set up" lines and the two generic failure lines are not here: no business is known yet when they show, or they are system messages. */
const FIELD_LIST: CheckInTextField[] = [
  { key: 'greeting', label: 'Greeting', group: 'Phone page' },
  { key: 'checkInButton', label: 'Check-in button', group: 'Phone page' },
  { key: 'checkingIn', label: 'While checking in', group: 'Phone page' },
  { key: 'checkedIn', label: 'After checking in', group: 'Phone page' },
  { key: 'ready', label: 'When staff are ready for them', group: 'Phone page' },
  { key: 'started', label: 'When the appointment has started', group: 'Phone page' },
  { key: 'readyEmailSubject', label: 'Subject of the email sent with "ready for them"', group: 'Phone page' },
  { key: 'cannotCheckIn', label: 'When check-in is no longer possible', group: 'Phone page' },
  { key: 'formsAllDone', label: 'Heading: all forms complete', group: 'Forms list' },
  { key: 'formsOne', label: 'Heading: one form to complete', group: 'Forms list' },
  { key: 'formsMany', label: 'Heading: several forms to complete', group: 'Forms list' },
  { key: 'formDone', label: 'A completed form', group: 'Forms list' },
  { key: 'formTodo', label: 'A form not completed yet', group: 'Forms list' },
  { key: 'formRedo', label: 'A form that must be completed again', group: 'Forms list' },
  { key: 'formFill', label: 'Button to fill in a form', group: 'Forms list' },
  { key: 'kioskWelcome', label: 'Welcome heading', group: 'Kiosk' },
  { key: 'kioskPrompt', label: 'Instruction', group: 'Kiosk' },
  { key: 'kioskInputLabel', label: 'Label above the box', group: 'Kiosk' },
  { key: 'kioskSubmit', label: 'Check-in button', group: 'Kiosk' },
  { key: 'kioskWelcomeName', label: 'Welcome heading after check-in', group: 'Kiosk' },
  { key: 'kioskCheckedIn', label: 'Checked-in message', group: 'Kiosk' },
  { key: 'kioskAlreadyCheckedIn', label: 'Already checked-in message', group: 'Kiosk' },
  { key: 'kioskFormsTodo', label: 'Forms still to complete', group: 'Kiosk' },
  { key: 'kioskAllSet', label: 'Nothing more to do', group: 'Kiosk' },
  { key: 'kioskDone', label: 'Done button', group: 'Kiosk' },
  { key: 'kioskNothingToday', label: 'Heading: nothing scheduled today', group: 'Kiosk' },
  { key: 'kioskNothingTodayOne', label: 'Nothing today, one other appointment', group: 'Kiosk' },
  { key: 'kioskNothingTodayMany', label: 'Nothing today, other appointments', group: 'Kiosk' },
  { key: 'kioskNothingTodayHelp', label: 'Nothing today: what to do next', group: 'Kiosk' },
  { key: 'kioskBack', label: 'Back button', group: 'Kiosk' },
  { key: 'kioskOffTitle', label: 'Heading: kiosk switched off', group: 'Kiosk' },
  { key: 'kioskOffBody', label: 'Kiosk switched off', group: 'Kiosk' },
];

/** Every detail a screen can mention once the visit is known. */
const ALL_DETAILS: NonNullable<CheckInTextField['placeholders']> = ['first_name', 'service_name', 'time', 'business_name'];
/** Screens shown before anyone is identified (kiosk entry, nothing today, switched off) know only the business. */
const BUSINESS_ONLY_KEYS: readonly CheckInTextKey[] = [
  'kioskWelcome', 'kioskPrompt', 'kioskInputLabel', 'kioskSubmit', 'kioskBack',
  'kioskNothingToday', 'kioskNothingTodayOne', 'kioskNothingTodayMany', 'kioskNothingTodayHelp',
  'kioskOffTitle', 'kioskOffBody',
];

/** The wording a business may edit, with the details each piece can mention. */
export const CHECK_IN_TEXT_FIELDS: CheckInTextField[] = FIELD_LIST.map((f) => ({
  ...f,
  placeholders: BUSINESS_ONLY_KEYS.includes(f.key) ? ['business_name'] : ALL_DETAILS,
}));

/** Writes the customer's details into every piece of wording at once. */
export function fillCheckInTexts(texts: CheckInText, values: Record<string, string | number | null | undefined>): CheckInText {
  const out = { ...texts };
  for (const k of CHECK_IN_TEXT_KEYS) out[k] = fillText(texts[k], values);
  return out;
}
/** The keys a business may override. */
export const EDITABLE_CHECK_IN_TEXT_KEYS: readonly CheckInTextKey[] = CHECK_IN_TEXT_FIELDS.map((f) => f.key);

/** The complete default wording of every supported language. */
export const CHECK_IN_TEXT_DEFAULTS: Record<SupportedLanguage, CheckInText> = {
  en: {
    loading: 'Loading…',
    greeting: 'Hello, {{first_name}}',
    checkInButton: "I'm here",
    checkingIn: 'Checking in…',
    checkedIn: 'You are checked in. Please take a seat; we will be with you shortly.',
    ready: 'Please come in. We are ready for you.',
    started: 'Your appointment has started.',
    cannotCheckIn: 'This appointment can no longer be checked in. Please see the front desk.',
    formsLabel: 'Forms for your visit',
    formsAllDone: 'Your forms are complete',
    formsOne: 'Please complete this form before your appointment',
    formsMany: 'Please complete these forms before your appointment',
    formDone: 'Completed',
    formRedo: 'Needs to be completed again',
    formTodo: 'Not completed yet',
    formFill: 'Fill in',
    formOpening: 'Opening…',
    kioskWelcome: 'Welcome',
    kioskPrompt: 'Please check in. Enter the phone number or email address you booked with.',
    kioskInputLabel: 'Phone number or email address',
    kioskSubmit: 'Check in',
    kioskWelcomeName: 'Welcome, {{first_name}}',
    kioskCheckedIn: 'You are checked in for {{service_name}} at {{time}}.',
    kioskAlreadyCheckedIn: 'You are already checked in for {{service_name}} at {{time}}.',
    kioskFormsTodo: 'You can fill these in now, or later at the front desk.',
    kioskAllSet: 'All set. Please take a seat.',
    kioskDone: 'Done',
    kioskBack: 'Back',
    kioskNothingToday: 'Nothing is scheduled for today',
    kioskNothingTodayOne: 'We could not find an appointment for you today, but you have this appointment:',
    kioskNothingTodayMany: 'We could not find an appointment for you today, but you have these appointments:',
    kioskNothingTodayHelp: 'If one of these should be today, please see the front desk. It may have been moved.',
    kioskOffTitle: 'Check-in is not available',
    kioskOffBody: 'This kiosk is switched off. Please see the front desk.',
    kioskNotSetUpTitle: 'This screen is not set up',
    kioskNotSetUpBody: 'Ask a member of staff to open the check-in screen from Settings > Check-In Kiosk.',
    readyEmailSubject: '{{business_name}}: we are ready for you',
    checkInFailed: 'Check-in did not work. Please see the front desk.',
    formFailed: 'The form could not be opened. Please see the front desk.',
  },
};

/**
 * The wording for a language: the business's own wording where it wrote some, otherwise the default. An
 * unsupported language gets the default language's wording.
 */
export function checkInTextFor(language: string | null | undefined, overrides?: Partial<Record<string, string>> | null): CheckInText {
  const lang: SupportedLanguage = isSupportedLanguage(language) ? language : DEFAULT_LANGUAGE;
  const merged: CheckInText = { ...CHECK_IN_TEXT_DEFAULTS[lang] };
  for (const key of EDITABLE_CHECK_IN_TEXT_KEYS) {
    const v = overrides?.[key];
    if (typeof v === 'string' && v.trim() !== '') merged[key] = v;
  }
  return merged;
}

/** Writes details into a piece of wording: `{{first_name}}` becomes the value, an unknown name becomes nothing. */
export function fillText(text: string, values: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    const v = values[key];
    return v == null ? '' : String(v);
  });
}
