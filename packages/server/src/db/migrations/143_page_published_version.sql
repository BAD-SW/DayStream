-- A website page keeps the version that was published. Until now the public page read the
-- working copy, so every saved edit was live at once and "publish" only set a flag.

ALTER TABLE web_pages
  ADD COLUMN IF NOT EXISTS published_title VARCHAR(255),
  ADD COLUMN IF NOT EXISTS published_blocks JSONB,
  ADD COLUMN IF NOT EXISTS published_seo JSONB;

UPDATE web_pages
   SET published_title = title, published_blocks = content_blocks, published_seo = seo_config
 WHERE status = 'published' AND published_blocks IS NULL;
