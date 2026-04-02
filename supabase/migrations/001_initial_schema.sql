-- =============================================
-- WEGWIJZER — Initiële database schema
-- =============================================

-- 1. TABELLEN
-- =============================================

-- Tenants tabel (multi-tenant ondersteuning)
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naam text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Profiles tabel (gekoppeld aan auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  naam text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'medewerker' CHECK (role IN ('admin', 'medewerker')),
  functiegroep text CHECK (functiegroep IN (
    'ambulant_begeleider',
    'ambulant_persoonlijk_begeleider',
    'woonbegeleider',
    'persoonlijk_woonbegeleider'
  )),
  startdatum date,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Documents tabel (geüploade bestanden metadata)
CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  naam text NOT NULL,
  bestandspad text NOT NULL,
  geupload_door uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Conversations tabel (vragen en antwoorden)
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vraag text NOT NULL,
  antwoord text,
  feedback text CHECK (feedback IN ('goed', 'niet_goed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. INDEXEN
-- =============================================
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_id ON public.profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON public.documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_id ON public.conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON public.conversations(created_at);

-- 3. ROW LEVEL SECURITY INSCHAKELEN
-- =============================================
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- 4. HULPFUNCTIES
-- =============================================

-- Functie om tenant_id van ingelogde gebruiker op te halen
CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Functie om role van ingelogde gebruiker op te halen
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Functie om profile id van ingelogde gebruiker op te halen
CREATE OR REPLACE FUNCTION public.get_my_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- 5. RLS POLICIES — TENANTS
-- =============================================

-- Admin kan eigen tenant lezen
CREATE POLICY "admin_read_own_tenant"
  ON public.tenants
  FOR SELECT
  USING (id = public.get_my_tenant_id());

-- 6. RLS POLICIES — PROFILES
-- =============================================

-- Medewerker ziet alleen eigen profiel
CREATE POLICY "medewerker_read_own_profile"
  ON public.profiles
  FOR SELECT
  USING (
    user_id = auth.uid()
  );

-- Admin ziet alle profielen binnen eigen tenant
CREATE POLICY "admin_read_tenant_profiles"
  ON public.profiles
  FOR SELECT
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Admin kan profielen aanmaken binnen eigen tenant
CREATE POLICY "admin_insert_profiles"
  ON public.profiles
  FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Admin kan profielen bijwerken binnen eigen tenant
CREATE POLICY "admin_update_profiles"
  ON public.profiles
  FOR UPDATE
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  )
  WITH CHECK (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Admin kan profielen verwijderen binnen eigen tenant
CREATE POLICY "admin_delete_profiles"
  ON public.profiles
  FOR DELETE
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- 7. RLS POLICIES — DOCUMENTS
-- =============================================

-- Alleen admin kan documenten lezen (medewerkers via edge function)
CREATE POLICY "admin_read_documents"
  ON public.documents
  FOR SELECT
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Admin kan documenten uploaden
CREATE POLICY "admin_insert_documents"
  ON public.documents
  FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Admin kan documenten verwijderen
CREATE POLICY "admin_delete_documents"
  ON public.documents
  FOR DELETE
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- 8. RLS POLICIES — CONVERSATIONS
-- =============================================

-- Medewerker ziet alleen eigen gesprekken
CREATE POLICY "medewerker_read_own_conversations"
  ON public.conversations
  FOR SELECT
  USING (
    user_id = public.get_my_profile_id()
  );

-- Admin ziet alle gesprekken binnen eigen tenant
CREATE POLICY "admin_read_tenant_conversations"
  ON public.conversations
  FOR SELECT
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Medewerker kan eigen gesprekken aanmaken
CREATE POLICY "medewerker_insert_conversations"
  ON public.conversations
  FOR INSERT
  WITH CHECK (
    user_id = public.get_my_profile_id()
    AND tenant_id = public.get_my_tenant_id()
  );

-- Medewerker kan feedback geven op eigen gesprekken
CREATE POLICY "medewerker_update_own_feedback"
  ON public.conversations
  FOR UPDATE
  USING (
    user_id = public.get_my_profile_id()
  )
  WITH CHECK (
    user_id = public.get_my_profile_id()
  );

-- 9. STORAGE BUCKET VOOR DOCUMENTEN
-- =============================================

-- Maak storage bucket aan voor documenten
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: alleen admin kan uploaden
CREATE POLICY "admin_upload_documents"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND public.get_my_role() = 'admin'
  );

-- Storage policy: alleen admin kan documenten lezen
CREATE POLICY "admin_read_storage_documents"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'documents'
    AND public.get_my_role() = 'admin'
  );

-- Storage policy: alleen admin kan documenten verwijderen
CREATE POLICY "admin_delete_storage_documents"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'documents'
    AND public.get_my_role() = 'admin'
  );

-- 10. TRIGGER: MAAK DEFAULT TENANT + ADMIN PROFIEL
-- =============================================

-- Functie die wordt aangeroepen wanneer een nieuwe user wordt aangemaakt
-- Als er nog geen tenant bestaat, maak er één aan (eerste setup)
-- Het profiel wordt aangemaakt door de admin via de invite flow
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
  _role text;
  _functiegroep text;
  _naam text;
BEGIN
  -- Haal metadata op uit de invite (gezet door admin bij uitnodigen)
  _role := COALESCE(NEW.raw_user_meta_data->>'role', 'medewerker');
  _functiegroep := NEW.raw_user_meta_data->>'functiegroep';
  _naam := COALESCE(NEW.raw_user_meta_data->>'naam', '');

  -- Zoek bestaande tenant of maak een nieuwe aan
  IF _role = 'admin' THEN
    -- Admin: maak nieuwe tenant als die nog niet bestaat
    SELECT id INTO _tenant_id FROM public.tenants LIMIT 1;
    IF _tenant_id IS NULL THEN
      INSERT INTO public.tenants (naam)
      VALUES ('AHMN')
      RETURNING id INTO _tenant_id;
    END IF;
  ELSE
    -- Medewerker: gebruik tenant_id uit metadata (gezet door admin)
    _tenant_id := (NEW.raw_user_meta_data->>'tenant_id')::uuid;
    -- Fallback: pak eerste tenant
    IF _tenant_id IS NULL THEN
      SELECT id INTO _tenant_id FROM public.tenants LIMIT 1;
    END IF;
  END IF;

  -- Maak profiel aan
  INSERT INTO public.profiles (user_id, email, naam, role, functiegroep, tenant_id)
  VALUES (
    NEW.id,
    NEW.email,
    _naam,
    _role,
    _functiegroep,
    _tenant_id
  );

  RETURN NEW;
END;
$$;

-- Trigger op auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
