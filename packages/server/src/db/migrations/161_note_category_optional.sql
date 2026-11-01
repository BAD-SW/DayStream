-- A note can be added without a category (David, 2026-11-01): a business may have no note
-- categories, and a note should never be blocked for that.
ALTER TABLE cus_notes ALTER COLUMN category DROP NOT NULL;
