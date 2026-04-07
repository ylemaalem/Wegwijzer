-- =============================================
-- WEGWIJZER — Migratie 026
-- Mappen voor documenten
-- =============================================

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS map text;
