-- =============================================
-- WEGWIJZER — Migratie 030
-- Demo tenant aanmaken
-- =============================================

-- Maak demo tenant aan (als die nog niet bestaat)
INSERT INTO public.tenants (naam)
SELECT 'Demo — Wegwijzer'
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenants WHERE naam = 'Demo — Wegwijzer'
);

-- Voeg demo settings toe
INSERT INTO public.settings (tenant_id, sleutel, waarde)
SELECT t.id, 'organisatienaam', 'Demo — Wegwijzer'
FROM public.tenants t WHERE t.naam = 'Demo — Wegwijzer'
AND NOT EXISTS (
  SELECT 1 FROM public.settings s
  WHERE s.tenant_id = t.id AND s.sleutel = 'organisatienaam'
);

INSERT INTO public.settings (tenant_id, sleutel, waarde)
SELECT t.id, 'primaire_kleur', '#0D5C6B'
FROM public.tenants t WHERE t.naam = 'Demo — Wegwijzer'
AND NOT EXISTS (
  SELECT 1 FROM public.settings s
  WHERE s.tenant_id = t.id AND s.sleutel = 'primaire_kleur'
);

INSERT INTO public.settings (tenant_id, sleutel, waarde)
SELECT t.id, 'disclaimer', 'Dit is een demo-omgeving. Deel geen echte persoonsgegevens.'
FROM public.tenants t WHERE t.naam = 'Demo — Wegwijzer'
AND NOT EXISTS (
  SELECT 1 FROM public.settings s
  WHERE s.tenant_id = t.id AND s.sleutel = 'disclaimer'
);

-- Demo admin account moet handmatig aangemaakt worden:
-- 1. Ga naar Supabase Dashboard → Authentication → Users
-- 2. Klik "Add user" → email: demo@mijnwegwijzer.com
-- 3. Na aanmaken: update het profiel:
--    UPDATE profiles SET role = 'admin'
--    WHERE email = 'demo@mijnwegwijzer.com';
