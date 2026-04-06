-- =============================================
-- WEGWIJZER — Migratie 020
-- Admin email updaten in profiles tabel
-- =============================================

UPDATE public.profiles
SET email = 'info@mijnwegwijzer.com'
WHERE email = 'y.lemaalem@ambulantehulpverlening.nl';

-- De auth.users tabel vereist handmatige update via Supabase Dashboard:
-- Authentication > Users > y.lemaalem@ambulantehulpverlening.nl
-- Wijzig email naar info@mijnwegwijzer.com
--
-- OF voer deze query uit in SQL Editor (als je admin rechten hebt):
-- UPDATE auth.users SET email = 'info@mijnwegwijzer.com'
--   WHERE email = 'y.lemaalem@ambulantehulpverlening.nl';
