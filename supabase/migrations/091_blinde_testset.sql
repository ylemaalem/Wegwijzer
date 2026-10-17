-- 091: blinde testset. Vragen die claude-sonnet-5-5 maakte uit willekeurige
-- documentstukken (documenten die niet in de regressietestset zitten), om de
-- bot te meten op vragen waarop niet is bijgestuurd. Alleen voor de service
-- role: geen policies, geen rechten voor anon/authenticated.
CREATE TABLE IF NOT EXISTS public.blinde_testvragen (
  id               serial PRIMARY KEY,
  tenant_id        uuid NOT NULL,
  vraag            text NOT NULL,
  antwoord         text NOT NULL,
  kernfeit_groepen jsonb NOT NULL,
  min_treffers     integer,
  document_id      uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  document_naam    text,
  chunk_id         uuid,
  chunk_index      integer,
  model            text,
  gecontroleerd    text CHECK (gecontroleerd IS NULL OR gecontroleerd IN ('goed', 'aangepast', 'afgekeurd')),
  actief           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.blinde_testvragen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.blinde_testvragen FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.blinde_testvragen_id_seq FROM anon, authenticated;
