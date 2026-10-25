-- 109: veilig verwijderen van een account (D3, akkoord Younes 2026-10-25).
-- Voorheen wiste verwijderen bij Medewerkers via de cascade alle gesprekken, en mislukte
-- het stil bij een rij in app_feedback, document_aanvragen_beheer of onboarding_checklist.
-- Nu:
-- - conversations.user_id mag leeg zijn en wordt bij het verwijderen van het profiel leeg
--   (ON DELETE SET NULL). De tekst blijft dan, losgekoppeld van de persoon, 12 maanden
--   bewaard (losgekoppeld_op) en wordt daarna 's nachts gewist. Dit is NIET anoniem: de
--   tekst kan iemand herkenbaar maken. Noem het nergens "anoniem".
-- - Bij een AVG-verwijderverzoek worden vraag en antwoord direct gewist ('[verwijderd]');
--   alleen datum, organisatie, duimpje en zoekmethode blijven.
-- - app_feedback, document_aanvragen_beheer.ingediend_door, onboarding_checklist.afgerond_door:
--   ON DELETE SET NULL.
-- - verwijder_account(...): één transactie met controle (controleer_accountverwijdering),
--   de keuze bij een leidinggevende, loskoppelen of wissen, profiel verwijderen en een
--   auditregel door de database. Alleen aan te roepen door de server (service_role);
--   daarna verwijdert de Edge Function verwijder-gebruiker het inlogaccount.
-- Rechtentest: tests/sql/veilig_verwijderen.sql

-- 1. Gesprekken loskoppelen in plaats van wissen
ALTER TABLE public.conversations ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS losgekoppeld_op timestamptz;
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_user_id_fkey;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Ook via de cascade (SET NULL) of een directe update: tijdstip van loskoppelen vastleggen.
CREATE OR REPLACE FUNCTION public.zet_losgekoppeld_op()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.user_id IS NOT NULL AND NEW.user_id IS NULL AND NEW.losgekoppeld_op IS NULL THEN
    NEW.losgekoppeld_op := now();
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.zet_losgekoppeld_op() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_conversations_losgekoppeld ON public.conversations;
CREATE TRIGGER trg_conversations_losgekoppeld
  BEFORE UPDATE OF user_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.zet_losgekoppeld_op();

CREATE INDEX IF NOT EXISTS conversations_losgekoppeld_op_idx
  ON public.conversations (losgekoppeld_op) WHERE user_id IS NULL;

-- 2. Verwijzingen die het verwijderen blokkeerden
ALTER TABLE public.app_feedback DROP CONSTRAINT IF EXISTS app_feedback_medewerker_id_fkey;
ALTER TABLE public.app_feedback ADD CONSTRAINT app_feedback_medewerker_id_fkey
  FOREIGN KEY (medewerker_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.document_aanvragen_beheer ALTER COLUMN ingediend_door DROP NOT NULL;
ALTER TABLE public.document_aanvragen_beheer DROP CONSTRAINT IF EXISTS document_aanvragen_beheer_ingediend_door_fkey;
ALTER TABLE public.document_aanvragen_beheer ADD CONSTRAINT document_aanvragen_beheer_ingediend_door_fkey
  FOREIGN KEY (ingediend_door) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.onboarding_checklist DROP CONSTRAINT IF EXISTS onboarding_checklist_afgerond_door_fkey;
ALTER TABLE public.onboarding_checklist ADD CONSTRAINT onboarding_checklist_afgerond_door_fkey
  FOREIGN KEY (afgerond_door) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 3. Eén route voor verwijderen
-- p_modus: 'uit_dienst' (tekst loskoppelen, 12 maanden) of 'avg' (tekst direct wissen).
-- p_leidinggevende: bij een rij in teamleiders verplicht:
--   'chattoegang_uit'  = niets verwijderen, alleen_dashboard aan (standaard in het venster);
--   'ook_leidinggevende' = rij in teamleiders én account verwijderen.
-- Geeft jsonb terug: {fout} | {keuze_nodig, leidinggevende_rol} | {actie, user_id, ...}.
CREATE OR REPLACE FUNCTION public.verwijder_account(
  p_beller uuid, p_profiel uuid, p_modus text, p_leidinggevende text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doel record;
  v_beller record;
  v_rij record;
  v_weigering text;
  v_aantal int := 0;
  v_details jsonb;
BEGIN
  IF p_modus NOT IN ('uit_dienst', 'avg') THEN
    RETURN jsonb_build_object('fout', 'Onbekende verwijdermodus.');
  END IF;
  IF p_leidinggevende IS NOT NULL AND p_leidinggevende NOT IN ('chattoegang_uit', 'ook_leidinggevende') THEN
    RETURN jsonb_build_object('fout', 'Onbekende keuze voor de leidinggevende.');
  END IF;

  SELECT id, user_id, tenant_id, email, naam, role, alleen_dashboard INTO v_doel
    FROM public.profiles WHERE id = p_profiel;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('fout', 'Profiel niet gevonden. Er is niets verwijderd.');
  END IF;

  -- Zelfde beslisregel als voorheen: beheerder, eigen organisatie, niet het eigen account.
  v_weigering := public.controleer_accountverwijdering(p_beller, v_doel.user_id, p_profiel);
  IF v_weigering IS NOT NULL THEN
    RETURN jsonb_build_object('fout', v_weigering);
  END IF;
  SELECT p.email, p.naam INTO v_beller FROM public.profiles p WHERE p.user_id = p_beller LIMIT 1;

  -- Leidinggevende? Dan eerst kiezen.
  SELECT id, rol INTO v_rij FROM public.teamleiders
   WHERE tenant_id = v_doel.tenant_id AND lower(btrim(email)) = lower(btrim(v_doel.email))
   LIMIT 1;
  IF FOUND THEN
    IF p_leidinggevende IS NULL THEN
      RETURN jsonb_build_object('keuze_nodig', true, 'leidinggevende_rol', COALESCE(v_rij.rol, 'teamleider'),
                                'naam', v_doel.naam, 'alleen_dashboard', v_doel.alleen_dashboard);
    END IF;
    IF p_leidinggevende = 'chattoegang_uit' THEN
      IF v_doel.role <> 'teamleider' THEN
        RETURN jsonb_build_object('fout', 'Dit account heeft geen leidinggevende-rol. Gebruik eerst 📧 Herstellen bij Leidinggevende/HR.');
      END IF;
      UPDATE public.profiles SET alleen_dashboard = true WHERE id = v_doel.id;
      INSERT INTO public.audit_log (tenant_id, user_id, user_email, user_naam, actie, object_type, object_id, details)
      VALUES (v_doel.tenant_id, p_beller, v_beller.email, v_beller.naam, 'CHATTOEGANG_GEWIJZIGD', 'medewerker', v_doel.id,
              jsonb_build_object('email', v_doel.email, 'naam', v_doel.naam, 'alleen_dashboard', true,
                                 'teamleider_rij', v_rij.id, 'reden', 'gekozen bij verwijderen'));
      RETURN jsonb_build_object('actie', 'chattoegang_uit');
    END IF;
    -- ook_leidinggevende: de rij weg (intrek_leidinggevende_rol schrijft daar een auditregel bij).
    DELETE FROM public.teamleiders WHERE id = v_rij.id;
  END IF;

  IF p_modus = 'avg' THEN
    UPDATE public.conversations
       SET vraag = '[verwijderd]', antwoord = '[verwijderd]', user_id = NULL,
           herkomst = NULL, studytube_trainingen = NULL, gebruikte_document_ids = NULL,
           kennisbank_match = NULL, feedback_op = NULL, feedback_afgehandeld_op = NULL
     WHERE user_id = v_doel.id;
    GET DIAGNOSTICS v_aantal = ROW_COUNT;
    -- Gegevens zonder verwijzing naar het profiel (user_id = auth-id of profiel-id).
    DELETE FROM public.push_subscriptions WHERE user_id = v_doel.user_id;
    DELETE FROM public.push_log WHERE user_id = v_doel.user_id;
    DELETE FROM public.fgl_diagnostics WHERE user_id = v_doel.id;
  ELSE
    UPDATE public.conversations SET user_id = NULL WHERE user_id = v_doel.id;
    GET DIAGNOSTICS v_aantal = ROW_COUNT;
  END IF;

  DELETE FROM public.profiles WHERE id = v_doel.id;

  -- Bij AVG geen naam of e-mailadres in het auditlog, alleen het profiel-id.
  v_details := jsonb_build_object('modus', p_modus, 'gesprekken', v_aantal, 'user_id', v_doel.user_id,
                                  'leidinggevende', p_leidinggevende);
  IF p_modus = 'uit_dienst' THEN
    v_details := v_details || jsonb_build_object('email', v_doel.email, 'naam', v_doel.naam);
  END IF;
  INSERT INTO public.audit_log (tenant_id, user_id, user_email, user_naam, actie, object_type, object_id, details)
  VALUES (v_doel.tenant_id, p_beller, v_beller.email, v_beller.naam,
          CASE WHEN p_modus = 'avg' THEN 'ACCOUNT_VERWIJDERD_AVG' ELSE 'MEDEWERKER_VERWIJDERD' END,
          'medewerker', v_doel.id, v_details);

  RETURN jsonb_build_object('actie', 'verwijderd', 'user_id', v_doel.user_id, 'gesprekken', v_aantal, 'modus', p_modus);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.verwijder_account(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verwijder_account(uuid, uuid, text, text) TO service_role;

-- 4. Nachtelijk: losgekoppelde gesprekstekst na 12 maanden wissen
CREATE OR REPLACE FUNCTION public.wis_losgekoppelde_gesprekken()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_aantal int;
BEGIN
  UPDATE public.conversations
     SET vraag = '[verwijderd]', antwoord = '[verwijderd]',
         herkomst = NULL, studytube_trainingen = NULL, gebruikte_document_ids = NULL,
         kennisbank_match = NULL, feedback_op = NULL, feedback_afgehandeld_op = NULL
   WHERE user_id IS NULL
     AND losgekoppeld_op < now() - interval '12 months'
     AND vraag <> '[verwijderd]';
  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  RETURN v_aantal;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.wis_losgekoppelde_gesprekken() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'wis-losgekoppelde-gesprekken-dagelijks';
SELECT cron.schedule('wis-losgekoppelde-gesprekken-dagelijks', '15 3 * * *', 'SELECT public.wis_losgekoppelde_gesprekken();');
