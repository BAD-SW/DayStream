-- Segment filters (THE-18, David 2026-11-04): address matching that is not case-sensitive, ignores
-- accents and punctuation, and treats common abbreviations as the same word (Av., Avda, Avenue,
-- Avenida; C/, Calle, Carrer; St, Street…). Small typos are tolerated with pg_trgm where the
-- database allows the extension; without it, matching still works without typo tolerance.

CREATE OR REPLACE FUNCTION ds_norm_address(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(
        translate(lower(coalesce(t, '')), 'áàäâãåéèëêíìïîóòöôõúùüûñçºª', 'aaaaaaeeeeiiiiooooouuuuncoa'),
        '[^a-z0-9]+', ' ', 'g'),
      '\m(avenida|avenue|avinguda|avda|ave|av)\M', 'av', 'g'),
      '\m(calle|carrer|cl|c)\M', 'c', 'g'),
      '\m(street|str|st)\M', 'st', 'g'),
      '\m(plaza|placa|plz|pza|pl)\M', 'pl', 'g'),
      '\m(paseo|passeig|pso|pg)\M', 'pg', 'g'),
      '\m(carretera|ctra)\M', 'ctra', 'g'),
      '\m(road|rd)\M', 'rd', 'g'),
      '\m(boulevard|blvd)\M', 'blvd', 'g'),
    '\s+', ' ', 'g'))
$$;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm not available: address filters work without typo tolerance';
END $$;
