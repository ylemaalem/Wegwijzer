-- heeft_embeddings kolom: geeft aan of een document vector embeddings heeft
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS heeft_embeddings BOOLEAN DEFAULT FALSE;

-- Backfill: documenten die chunks hebben in document_chunks krijgen TRUE
UPDATE public.documents d
SET heeft_embeddings = TRUE
WHERE d.id IN (SELECT DISTINCT document_id FROM public.document_chunks);
