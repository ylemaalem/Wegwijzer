-- =============================================
-- Voeg inwerktraject_url kolom toe aan profiles
-- Plak dit in Supabase SQL Editor en klik Run
-- =============================================

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS inwerktraject_url text;
