-- =============================================
-- WEGWIJZER — Migratie 020
-- Admin email updaten
-- =============================================

-- Update email in profiles tabel
UPDATE public.profiles
SET email = 'info@mijnwegwijzer.com'
WHERE email = 'y.lemaalem@ambulantehulpverlening.nl';

-- HANDMATIG in Supabase Dashboard:
-- Ga naar Authentication > Users > y.lemaalem@ambulantehulpverlening.nl
-- Klik op de gebruiker en wijzig het emailadres naar info@mijnwegwijzer.com
-- OF voer uit in SQL Editor:
-- UPDATE auth.users SET email = 'info@mijnwegwijzer.com' WHERE email = 'y.lemaalem@ambulantehulpverlening.nl';
