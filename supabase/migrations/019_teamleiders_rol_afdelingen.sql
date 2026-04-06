-- =============================================
-- WEGWIJZER — Migratie 019
-- Teamleiders tabel: rol en afdelingen kolommen
-- =============================================

ALTER TABLE public.teamleiders ADD COLUMN IF NOT EXISTS rol text DEFAULT 'teamleider';
ALTER TABLE public.teamleiders ADD COLUMN IF NOT EXISTS afdelingen text[];
