-- =============================================
-- FIX: Zet de rol van de admin gebruiker correct
-- Plak dit in Supabase SQL Editor en klik Run
-- =============================================

-- Stap 1: Bekijk de huidige staat van alle profielen
-- (resultaat verschijnt onderaan na Run)
SELECT
  p.id,
  p.email,
  p.naam,
  p.role,
  p.functiegroep,
  u.raw_user_meta_data->>'role' AS metadata_role
FROM public.profiles p
JOIN auth.users u ON u.id = p.user_id;

-- Stap 2: Synchroniseer de rol vanuit raw_user_meta_data
-- voor ALLE gebruikers wiens profiel-rol niet overeenkomt
UPDATE public.profiles
SET role = u.raw_user_meta_data->>'role'
FROM auth.users u
WHERE profiles.user_id = u.id
  AND u.raw_user_meta_data->>'role' IS NOT NULL
  AND u.raw_user_meta_data->>'role' IN ('admin', 'medewerker')
  AND profiles.role != u.raw_user_meta_data->>'role';
