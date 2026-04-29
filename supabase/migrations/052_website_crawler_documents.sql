-- =============================================
-- WEGWIJZER — Migratie 052
-- Website crawler: extra kolommen op documents zodat gecrawlde
-- subpagina's kunnen worden gegroepeerd onder hun parent-URL.
-- Bestaande documenten blijven ongemoeid — alle nieuwe kolommen
-- hebben default waarden of zijn nullable.
-- =============================================

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS parent_url text;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS crawled_at timestamptz;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS is_crawled_page boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_documents_parent_url
  ON public.documents (parent_url)
  WHERE parent_url IS NOT NULL;
