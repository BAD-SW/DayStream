-- Migration 170: document template language as a language code (spec 51 follow-up).
--
-- pay_document_branding.language was typed freely, so existing templates hold "English" while the
-- rest of the app (customers' preferred_language, forms, the language switcher) uses codes such as
-- 'en' and 'es'. A template could never be matched to a customer's language. The editor now offers
-- the supported languages only; this brings the existing values into line.
--
-- Known names are converted; a blank becomes NULL (the default template). Any other value is left
-- as it is, and the editor shows it as "not recognised" so the business can choose a language.

BEGIN;

UPDATE pay_document_branding SET language = NULL WHERE language IS NOT NULL AND BTRIM(language) = '';

UPDATE pay_document_branding SET language = 'en'
 WHERE LOWER(BTRIM(language)) IN ('english', 'inglés', 'ingles', 'en-us', 'en-gb', 'en_us', 'en_gb');

UPDATE pay_document_branding SET language = 'es'
 WHERE LOWER(BTRIM(language)) IN ('spanish', 'español', 'espanol', 'castellano', 'es-es', 'es-mx', 'es_es', 'es_mx');

UPDATE pay_document_branding SET language = LOWER(BTRIM(language))
 WHERE LOWER(BTRIM(language)) IN ('en', 'es') AND language <> LOWER(BTRIM(language));

COMMIT;
