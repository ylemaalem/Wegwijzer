-- Response cache voor chatbot-antwoorden.
-- Per-gebruiker cache met TTL: 24u standaard, 7 dagen voor CAO/salaris vragen.
-- Cache wordt geleegd bij elke document-mutatie (zie chat/index.ts en admin.js).
-- Verlopen entries worden opgeruimd in de terugblik-route.

CREATE TABLE IF NOT EXISTS public.response_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  vraag_hash TEXT NOT NULL,
  antwoord TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_response_cache_lookup
  ON public.response_cache(tenant_id, user_id, vraag_hash, expires_at);

-- Unieke constraint nodig voor onConflict-upsert vanuit de Edge Function.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_response_cache_key
  ON public.response_cache(tenant_id, user_id, vraag_hash);

ALTER TABLE public.response_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Gebruikers kunnen eigen cache lezen"
  ON public.response_cache FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Edge Functions kunnen cache schrijven"
  ON public.response_cache FOR ALL
  USING (TRUE)
  WITH CHECK (TRUE);
