-- =============================================
-- WEGWIJZER — Migratie 021
-- Definitieve fix admin email in profiles EN auth.users
-- =============================================

-- Update profiles tabel
UPDATE public.profiles
SET email = 'info@mijnwegwijzer.com'
WHERE email = 'y.lemaalem@ambulantehulpverlening.nl'
  AND role = 'admin';

-- Update auth.users tabel (vereist service role)
UPDATE auth.users
SET email = 'info@mijnwegwijzer.com',
    raw_user_meta_data = raw_user_meta_data || '{"email": "info@mijnwegwijzer.com"}'::jsonb
WHERE email = 'y.lemaalem@ambulantehulpverlening.nl';
