-- =============================================
-- WEGWIJZER — Migratie 035
-- Documenten: synoniemen + zoektermen kolommen
-- Voor opdracht 5 (handmatige synoniemen) en opdracht 8 (auto zoektermen)
-- =============================================

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS synoniemen text[];
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS zoektermen text[];

-- Index voor snelle array zoekopdrachten
CREATE INDEX IF NOT EXISTS idx_documents_zoektermen ON public.documents USING GIN (zoektermen);
CREATE INDEX IF NOT EXISTS idx_documents_synoniemen ON public.documents USING GIN (synoniemen);
