/**
 * Common IANA timezones with abbreviations for dropdown selection.
 * Time zone ids and abbreviations are codes, not translatable text, so the labels are the same in every language.
 */
// [IANA id, abbreviations]
const ZONES: [string, string][] = [
  // Americas
  ['America/New_York', 'EST/EDT'],
  ['America/Chicago', 'CST/CDT'],
  ['America/Denver', 'MST/MDT'],
  ['America/Los_Angeles', 'PST/PDT'],
  ['America/Anchorage', 'AKST/AKDT'],
  ['Pacific/Honolulu', 'HST'],
  ['America/Phoenix', 'MST'],
  ['America/Toronto', 'EST/EDT'],
  ['America/Vancouver', 'PST/PDT'],
  ['America/Mexico_City', 'CST'],
  ['America/Bogota', 'COT'],
  ['America/Lima', 'PET'],
  ['America/Buenos_Aires', 'ART'],
  ['America/Sao_Paulo', 'BRT'],
  // Europe
  ['Europe/London', 'GMT/BST'],
  ['Europe/Dublin', 'GMT/IST'],
  ['Europe/Paris', 'CET/CEST'],
  ['Europe/Berlin', 'CET/CEST'],
  ['Europe/Madrid', 'CET/CEST'],
  ['Europe/Rome', 'CET/CEST'],
  ['Europe/Amsterdam', 'CET/CEST'],
  ['Europe/Brussels', 'CET/CEST'],
  ['Europe/Zurich', 'CET/CEST'],
  ['Europe/Vienna', 'CET/CEST'],
  ['Europe/Stockholm', 'CET/CEST'],
  ['Europe/Oslo', 'CET/CEST'],
  ['Europe/Copenhagen', 'CET/CEST'],
  ['Europe/Helsinki', 'EET/EEST'],
  ['Europe/Warsaw', 'CET/CEST'],
  ['Europe/Prague', 'CET/CEST'],
  ['Europe/Bucharest', 'EET/EEST'],
  ['Europe/Athens', 'EET/EEST'],
  ['Europe/Istanbul', 'TRT'],
  ['Europe/Moscow', 'MSK'],
  // Asia
  ['Asia/Dubai', 'GST'],
  ['Asia/Kolkata', 'IST'],
  ['Asia/Bangkok', 'ICT'],
  ['Asia/Singapore', 'SGT'],
  ['Asia/Hong_Kong', 'HKT'],
  ['Asia/Shanghai', 'CST'],
  ['Asia/Seoul', 'KST'],
  ['Asia/Tokyo', 'JST'],
  // Oceania
  ['Australia/Sydney', 'AEST/AEDT'],
  ['Australia/Melbourne', 'AEST/AEDT'],
  ['Australia/Perth', 'AWST'],
  ['Australia/Brisbane', 'AEST'],
  ['Pacific/Auckland', 'NZST/NZDT'],
  // Africa
  ['Africa/Cairo', 'EET'],
  ['Africa/Lagos', 'WAT'],
  ['Africa/Johannesburg', 'SAST'],
  ['Africa/Nairobi', 'EAT'],
  // Other
  ['UTC', ''],
];

/** The picker options: the id is the value; the label is the id with its abbreviations, e.g. "America/New_York (EST/EDT)". */
export const TIMEZONES: { value: string; label: string }[] = ZONES.map(([value, abbreviations]) => ({
  value,
  label: abbreviations ? `${value} (${abbreviations})` : value,
}));
