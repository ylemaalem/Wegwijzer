-- =============================================
-- WEGWIJZER — Migratie 010
-- Rate limit uitbreidingen, inwerken_afgerond, nieuwe functiegroep
-- =============================================

-- 1. Rate limit uitbreidingen tabel
CREATE TABLE IF NOT EXISTS public.rate_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  datum date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(profile_id, datum)
);

ALTER TABLE public.rate_extensions ENABLE ROW LEVEL SECURITY;

-- Medewerker kan eigen extensies lezen en aanmaken
CREATE POLICY "user_read_own_extensions"
  ON public.rate_extensions FOR SELECT
  USING (profile_id = public.get_my_profile_id());

CREATE POLICY "user_insert_own_extensions"
  ON public.rate_extensions FOR INSERT
  WITH CHECK (profile_id = public.get_my_profile_id());

-- Service role kan alles (voor edge function)
CREATE POLICY "service_all_extensions"
  ON public.rate_extensions FOR ALL
  USING (true);

-- 2. Inwerken afgerond boolean
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS inwerken_afgerond boolean DEFAULT false;

-- 3. Functiegroep constraint uitbreiden met avond_nacht_begeleider
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_functiegroep_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_functiegroep_check
  CHECK (functiegroep IN (
    'ambulant_begeleider',
    'ambulant_persoonlijk_begeleider',
    'woonbegeleider',
    'persoonlijk_woonbegeleider',
    'avond_nacht_begeleider'
  ));
