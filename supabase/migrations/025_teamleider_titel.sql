-- =============================================
-- WEGWIJZER — Migratie 025
-- Titel veld voor teamleiders/managers
-- =============================================

ALTER TABLE public.teamleiders ADD COLUMN IF NOT EXISTS titel text;
