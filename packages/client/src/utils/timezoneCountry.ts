/**
 * Best-effort IANA timezone → ISO2 country guess, used only to pick a sensible
 * default for the phone country-code selector on the New Customer form (the
 * business itself has no explicit "country" field — see customers-page-
 * requirements.md §A5). Always independently editable by the user; this is a
 * convenience default, not a source of truth.
 */
const CITY_TO_ISO2: Record<string, string> = {
  Madrid: 'ES', London: 'GB', Paris: 'FR', Berlin: 'DE', Rome: 'IT', Lisbon: 'PT',
  Amsterdam: 'NL', Brussels: 'BE', Vienna: 'AT', Zurich: 'CH', Dublin: 'IE',
  Stockholm: 'SE', Oslo: 'NO', Copenhagen: 'DK', Helsinki: 'FI', Warsaw: 'PL',
  Athens: 'GR', Budapest: 'HU', Prague: 'CZ',
  New_York: 'US', Los_Angeles: 'US', Chicago: 'US', Denver: 'US', Phoenix: 'US',
  Toronto: 'CA', Vancouver: 'CA',
  Mexico_City: 'MX', Sao_Paulo: 'BR', Buenos_Aires: 'AR', Bogota: 'CO', Santiago: 'CL',
  Tokyo: 'JP', Shanghai: 'CN', Hong_Kong: 'HK', Singapore: 'SG', Seoul: 'KR',
  Kolkata: 'IN', Dubai: 'AE', Istanbul: 'TR',
  Sydney: 'AU', Melbourne: 'AU', Auckland: 'NZ',
  Johannesburg: 'ZA', Cairo: 'EG', Lagos: 'NG', Nairobi: 'KE',
};

/** e.g. "Europe/Madrid" -> "ES"; falls back to `fallback` (default "US") if unrecognized. */
export function isoCountryFromTimezone(timezone: string | null | undefined, fallback = 'US'): string {
  if (!timezone) return fallback;
  const city = timezone.split('/').pop();
  if (!city) return fallback;
  return CITY_TO_ISO2[city] || fallback;
}
