-- =============================================
-- WEGWIJZER — Migratie 024
-- Verwijder soft-deleted auth users permanent
-- =============================================

-- Verwijder het oude admin account dat soft-deleted is
DELETE FROM auth.users
WHERE email = 'y.lemaalem@ambulantehulpverlening.nl';

-- Verwijder eventueel bijbehorend profiel als dat nog bestaat
DELETE FROM public.profiles
WHERE email = 'y.lemaalem@ambulantehulpverlening.nl';
