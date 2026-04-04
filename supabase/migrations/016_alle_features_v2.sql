-- =============================================
-- WEGWIJZER — Migratie 016
-- Configureerbare functiegroepen, autorisatie,
-- rapporten, privacy, afdeling, regio verwijderen
-- =============================================

-- 1. Configureerbare functiegroepen tabel
CREATE TABLE IF NOT EXISTS public.functiegroepen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  naam text NOT NULL,
  beschrijving text,
  is_kantoor boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, code)
);

ALTER TABLE public.functiegroepen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_functiegroepen"
  ON public.functiegroepen FOR SELECT
  USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY "admin_crud_functiegroepen"
  ON public.functiegroepen FOR ALL
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

-- 2. Verwijder de vaste CHECK constraint op functiegroep
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_functiegroep_check;

-- 3. Afdeling veld toevoegen (voor kantoorpersoneel)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS afdeling text;

-- 4. Autorisatie velden per profiel
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vraag_limiet integer DEFAULT 30;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS extra_vragen integer DEFAULT 20;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rapport_toegang boolean DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS dashboard_toegang boolean DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS inwerktraject_actief boolean DEFAULT true;

-- 5. Regio kolom verwijderen
ALTER TABLE public.profiles DROP COLUMN IF EXISTS regio;

-- 6. Versienummer kolom verwijderen (als nog niet gedaan)
ALTER TABLE public.documents DROP COLUMN IF EXISTS versienummer;

-- 7. Rapporten tabel
CREATE TABLE IF NOT EXISTS public.rapporten (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  maand text NOT NULL,
  inhoud jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rapporten ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_rapporten"
  ON public.rapporten FOR SELECT
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "service_insert_rapporten"
  ON public.rapporten FOR INSERT
  WITH CHECK (tenant_id = public.get_my_tenant_id());

-- 8. Privacy verzoeken tabel
CREATE TABLE IF NOT EXISTS public.privacy_verzoeken (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  naam text NOT NULL,
  email text NOT NULL,
  type text NOT NULL CHECK (type IN ('inzage', 'correctie', 'verwijdering')),
  status text DEFAULT 'ontvangen',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.privacy_verzoeken ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_insert_privacy"
  ON public.privacy_verzoeken FOR INSERT
  WITH CHECK (tenant_id = public.get_my_tenant_id());

CREATE POLICY "admin_read_privacy"
  ON public.privacy_verzoeken FOR SELECT
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "admin_update_privacy"
  ON public.privacy_verzoeken FOR UPDATE
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

-- 9. Standaard functiegroepen invoegen (voor eerste tenant)
INSERT INTO public.functiegroepen (tenant_id, code, naam, beschrijving, is_kantoor)
SELECT t.id, fg.code, fg.naam, fg.beschrijving, fg.is_kantoor
FROM public.tenants t
CROSS JOIN (VALUES
  ('ambulant_begeleider', 'Ambulant Begeleider', 'Ondersteunt cliënten thuis bij dagelijkse hulpvragen. Werkt zelfstandig, reist tussen cliënten.', false),
  ('ambulant_persoonlijk_begeleider', 'Ambulant Persoonlijk Begeleider', 'Regiehouder over cliënten. Bewaakt overzicht over zorg, planning en doelen. Schrijft zorgplannen en indicaties.', false),
  ('woonbegeleider', 'Woonbegeleider', 'Ondersteunt cliënten vanuit een woonlocatie. Werkt in teamverband met vaste overdracht.', false),
  ('persoonlijk_woonbegeleider', 'Persoonlijk Woonbegeleider', 'Regiehouder vanuit de woonlocatie. Zorgplannen, indicaties en regievoering op locatie.', false),
  ('medewerker_avond_nachtdienst', 'Medewerker Avond-/Nachtdienst', 'Werkt in avond- en nachtdiensten, vaak alleen op locatie. Focus op veiligheid en crisis.', false),
  ('kantoorpersoneel', 'Kantoorpersoneel', 'Werkt op kantoor, ondersteunt de organisatie bij administratieve en organisatorische taken.', true),
  ('hr_medewerker', 'HR Medewerker', 'Verantwoordelijk voor personeelszaken, werving en selectie.', true),
  ('planner', 'Planner', 'Verantwoordelijk voor roostering en planning van medewerkers.', true),
  ('manager', 'Manager', 'Leidinggevende met verantwoordelijkheid over afdeling of team.', true),
  ('financien', 'Financiën', 'Verantwoordelijk voor financiële administratie en facturatie.', true),
  ('administratie', 'Administratie', 'Algemene administratieve ondersteuning.', true),
  ('overig_kantoor', 'Overig Kantoor', 'Overige kantoorfunctie.', true),
  ('stagiaire', 'Stagiaire', 'Leert en oriënteert zich binnen de organisatie. Extra begeleiding nodig.', false),
  ('zzp_uitzendkracht', 'ZZP / Uitzendkracht', 'Flexibel inzetbaar, werkt mogelijk in wisselende teams of locaties.', false)
) AS fg(code, naam, beschrijving, is_kantoor)
WHERE NOT EXISTS (SELECT 1 FROM public.functiegroepen WHERE tenant_id = t.id LIMIT 1);

CREATE INDEX IF NOT EXISTS idx_functiegroepen_tenant ON public.functiegroepen(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rapporten_tenant ON public.rapporten(tenant_id);
CREATE INDEX IF NOT EXISTS idx_privacy_tenant ON public.privacy_verzoeken(tenant_id);
