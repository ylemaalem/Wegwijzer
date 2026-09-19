-- =============================================
-- WEGWIJZER — Migratie 071
-- Kenniskloof op retrieval-staat + clustering, herkomst per antwoord,
-- meetkolommen, en herstel van gewiste negatieve feedback.
-- =============================================
-- Achtergrond (gemeten, zie onderzoek 19-09-2026):
--  * kenniskloof_meldingen werd gevuld op basis van de ANTWOORDTEKST van het
--    model ("ℹ️ Niet gevonden…"), onafhankelijk van de retrieval. 36 van de 73
--    koppelbare meldingen hadden wél documenten gevonden; 65% was geen kennisgat.
--  * Nieuwe logica (edge function): alleen loggen bij lege retrieval, en
--    gelijkende meldingen samenvoegen via registreer_kenniskloof().
--  * Clusterdrempel 0.70: gemeten op de 74 bestaande meldingen gaf dat nul
--    onterechte samenvoegingen (onterechte paren scoorden max 0.659), ten koste
--    van gemiste parafrasen tussen 0.59 en 0.70. Bewust precisie boven recall:
--    een onterechte samenvoeging verbergt een apart kennisgat.
--  * conversations.feedback werd door "verbeterpunt verwijderen" teruggezet
--    naar NULL, waardoor 0 van de negatieve feedback bewaard bleef. Het enige
--    codepad dat feedback op NULL zet filterde op feedback='niet_goed', dus
--    rijen met feedback_op gezet en feedback NULL waren aantoonbaar 'niet_goed'.
-- =============================================

BEGIN;

-- ------------------------------------------------------------
-- 1C — kolommen voor clustering
-- ------------------------------------------------------------
ALTER TABLE public.kenniskloof_meldingen
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS laatst_gevraagd_op timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS zoek_methode text;

-- ------------------------------------------------------------
-- Leegmaken — via archief, zodat niets onherroepelijk verloren gaat
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kenniskloof_meldingen_archief (
  id              uuid PRIMARY KEY,
  tenant_id       uuid,
  onderwerp       text NOT NULL,
  aantal_vragen   integer,
  status          text,
  created_at      timestamptz,
  gearchiveerd_op timestamptz NOT NULL DEFAULT now(),
  archief_reden   text
);

ALTER TABLE public.kenniskloof_meldingen_archief ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_read_kenniskloof_archief ON public.kenniskloof_meldingen_archief;
CREATE POLICY admin_read_kenniskloof_archief ON public.kenniskloof_meldingen_archief
  FOR SELECT
  USING (get_my_role() = 'admin' AND tenant_id = get_my_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kenniskloof_meldingen_archief TO anon, authenticated;

-- Vaste peildatum maakt dit idempotent: alleen meldingen van vóór deze migratie.
INSERT INTO public.kenniskloof_meldingen_archief
  (id, tenant_id, onderwerp, aantal_vragen, status, created_at, archief_reden)
SELECT id, tenant_id, onderwerp, aantal_vragen, status, created_at,
       'Gelogd op modeltekst i.p.v. retrieval-staat (vóór migratie 071); lijst was onbetrouwbaar'
FROM public.kenniskloof_meldingen
WHERE created_at < '2026-09-20'
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.kenniskloof_meldingen k
WHERE k.created_at < '2026-09-20'
  AND EXISTS (SELECT 1 FROM public.kenniskloof_meldingen_archief a WHERE a.id = k.id);

-- ------------------------------------------------------------
-- 1A/1C — registreren met samenvoegen
-- ------------------------------------------------------------
-- Zoekt eerst een open melding met identieke (genormaliseerde) tekst, daarna een
-- semantisch gelijkende (cosine >= p_drempel). Gevonden: teller ophogen.
-- Niet gevonden: nieuwe rij. Alleen aanroepbaar door de service role (edge).
CREATE OR REPLACE FUNCTION public.registreer_kenniskloof(
  p_tenant_id    uuid,
  p_onderwerp    text,
  p_embedding    vector(1536),
  p_zoek_methode text,
  p_drempel      float DEFAULT 0.70
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id   uuid;
  v_norm text := lower(regexp_replace(trim(coalesce(p_onderwerp, '')), '\s+', ' ', 'g'));
BEGIN
  IF v_norm = '' THEN
    RETURN 'overgeslagen';
  END IF;

  SELECT k.id INTO v_id
  FROM public.kenniskloof_meldingen k
  WHERE k.tenant_id = p_tenant_id
    AND k.status = 'nieuw'
    AND lower(regexp_replace(trim(k.onderwerp), '\s+', ' ', 'g')) = left(v_norm, 200)
  LIMIT 1;

  IF v_id IS NULL AND p_embedding IS NOT NULL THEN
    SELECT k.id INTO v_id
    FROM public.kenniskloof_meldingen k
    WHERE k.tenant_id = p_tenant_id
      AND k.status = 'nieuw'
      AND k.embedding IS NOT NULL
      AND 1 - (k.embedding <=> p_embedding) >= p_drempel
    ORDER BY k.embedding <=> p_embedding
    LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.kenniskloof_meldingen
       SET aantal_vragen = COALESCE(aantal_vragen, 1) + 1,
           laatst_gevraagd_op = now()
     WHERE id = v_id;
    RETURN 'samengevoegd';
  END IF;

  INSERT INTO public.kenniskloof_meldingen
    (tenant_id, onderwerp, aantal_vragen, embedding, zoek_methode, laatst_gevraagd_op)
  VALUES
    (p_tenant_id, left(trim(p_onderwerp), 200), 1, p_embedding, p_zoek_methode, now());
  RETURN 'nieuw';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registreer_kenniskloof(uuid, text, vector, text, float) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registreer_kenniskloof(uuid, text, vector, text, float) TO service_role;

-- ------------------------------------------------------------
-- 2A/3A — herkomst en meting per gesprek
-- ------------------------------------------------------------
-- herkomst: {"type": "organisatie"|"extern"|"organisatie_extern"|"geen_document",
--            "organisatie": [docnamen], "extern": [docnamen]} — afgeleid uit de
--            documenten die daadwerkelijk als context aan het model zijn gegeven,
--            NIET uit de tekst van het model. NULL = speciale route zonder label
--            (bronvraag, sparring, teamvraag) of gesprek van vóór deze migratie.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS herkomst jsonb,
  ADD COLUMN IF NOT EXISTS zoek_methode text,
  ADD COLUMN IF NOT EXISTS kennisbank_match boolean,
  ADD COLUMN IF NOT EXISTS feedback_afgehandeld_op timestamptz;

ALTER TABLE public.response_cache
  ADD COLUMN IF NOT EXISTS herkomst jsonb;

-- ------------------------------------------------------------
-- 3B — gewiste negatieve feedback herstellen
-- ------------------------------------------------------------
-- Gemarkeerd als afgehandeld (ze waren door de admin al verwerkt), zodat ze niet
-- opnieuw als verbeterpunt verschijnen, maar wél meetellen in de statistieken.
-- Het werkelijke afhandelmoment is onbekend; now() markeert het herstelmoment.
UPDATE public.conversations
   SET feedback = 'niet_goed',
       feedback_afgehandeld_op = now()
 WHERE feedback IS NULL
   AND feedback_op IS NOT NULL
   AND feedback_afgehandeld_op IS NULL;

COMMIT;
