-- 078: wekelijkse regressietest via pg_cron + pg_net.
--
-- De cron roept de chat Edge Function aan met {regressie_run:true} en de
-- testsleutel; de function draait de testset in testmodus en schrijft een
-- regressie_runs-rij weg. URL, anon key en testsleutel staan in private_config
-- (afgeschermde tabel, geen grants) zodat er geen geheim in deze migratie of in
-- git staat. private_config wordt apart gevuld (buiten git).
--
-- De job wordt AANGEMAAKT MAAR GEDEACTIVEERD, zodat er geen betaalde run draait
-- voordat de 40 vragen zijn goedgekeurd. Activeren:
--   UPDATE cron.job SET active = true WHERE jobname = 'regressie-test-wekelijks';

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.private_config (
  sleutel text PRIMARY KEY,
  waarde text NOT NULL
);
ALTER TABLE public.private_config ENABLE ROW LEVEL SECURITY;
-- Geen policies en geen grants → alleen bereikbaar voor postgres/service_role
-- (die RLS omzeilen). anon/authenticated kunnen niets.
REVOKE ALL ON TABLE public.private_config FROM anon, authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION public.run_regressie_test()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _url text;
  _anon text;
  _secret text;
BEGIN
  SELECT waarde INTO _url FROM public.private_config WHERE sleutel = 'chat_url';
  SELECT waarde INTO _anon FROM public.private_config WHERE sleutel = 'anon_key';
  SELECT waarde INTO _secret FROM public.private_config WHERE sleutel = 'test_secret';
  IF _url IS NULL OR _anon IS NULL OR _secret IS NULL THEN
    RAISE WARNING 'run_regressie_test: private_config onvolledig, run overgeslagen';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := _url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _anon,
      'apikey', _anon,
      'x-wegwijzer-test', _secret
    ),
    body := jsonb_build_object('regressie_run', true),
    timeout_milliseconds := 300000
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_regressie_test() FROM PUBLIC, anon, authenticated;

-- Wekelijks, maandag 05:00. Eerst een eventuele oude job opruimen, dan plannen
-- en meteen DEACTIVEREN (via cron.alter_job; directe UPDATE op cron.job mag niet).
DO $$
DECLARE _jid bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'regressie-test-wekelijks') THEN
    PERFORM cron.unschedule('regressie-test-wekelijks');
  END IF;
  _jid := cron.schedule('regressie-test-wekelijks', '0 5 * * 1', 'SELECT public.run_regressie_test();');
  PERFORM cron.alter_job(job_id := _jid, active := false);
END $$;
