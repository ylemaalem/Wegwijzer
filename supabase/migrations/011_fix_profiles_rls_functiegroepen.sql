-- =============================================
-- WEGWIJZER — Migratie 011
-- Hernoem functiegroep, nieuwe functiegroepen
-- (Teamleider RLS policies verplaatst naar migratie 014)
-- =============================================

-- 1. Hernoem avond_nacht_begeleider naar medewerker_avond_nachtdienst
UPDATE public.profiles SET functiegroep = 'medewerker_avond_nachtdienst' WHERE functiegroep = 'avond_nacht_begeleider';

-- 2. Functiegroep constraint uitbreiden met alle nieuwe groepen
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_functiegroep_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_functiegroep_check
  CHECK (functiegroep IN (
    'ambulant_begeleider',
    'ambulant_persoonlijk_begeleider',
    'woonbegeleider',
    'persoonlijk_woonbegeleider',
    'medewerker_avond_nachtdienst',
    'kantoorpersoneel',
    'stagiaire',
    'zzp_uitzendkracht'
  ));
