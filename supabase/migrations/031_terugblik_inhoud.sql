-- Voeg inhoud kolom toe aan terugblik_log
ALTER TABLE public.terugblik_log ADD COLUMN IF NOT EXISTS inhoud text;
ALTER TABLE public.terugblik_log ADD COLUMN IF NOT EXISTS ontvangers text[];
ALTER TABLE public.terugblik_log ADD COLUMN IF NOT EXISTS team text;
