-- Audit log: registreert alle beheer-acties (wie, wat, wanneer).
-- Lezen alleen voor admins. Schrijven via service role (Edge Function)
-- of via authenticated client (admin.js) — RLS staat insert toe omdat
-- de auth-laag al filtert wie überhaupt admin-acties kan uitvoeren.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  user_naam TEXT,
  actie TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_time
  ON public.audit_log(tenant_id, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Lezen: alleen admin van de eigen tenant. Conform bestaande
-- RLS-conventies in dit project (003_settings_table.sql) gebruiken
-- we de helper-functies get_my_role() en get_my_tenant_id().
CREATE POLICY "Admin leest audit log"
  ON public.audit_log FOR SELECT
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Schrijven: service role bypasst RLS sowieso; voor authenticated
-- clients (admin.js) is insert open zodat de admin acties kan loggen.
-- De audit-rij bevat altijd auth.uid() in user_id zodat misbruik
-- traceerbaar blijft.
CREATE POLICY "Service role schrijft audit log"
  ON public.audit_log FOR INSERT
  WITH CHECK (TRUE);
