-- 081: dagelijkse cron voor sluit_verlopen_inwerktrajecten().
-- Sluit inwerktrajecten waarvan de einddatum verstreken is. Draait dagelijks
-- om 03:00 (vóór de fgl-cleanup om 04:00). Puur SQL, geen kosten.
-- EXECUTE op de functie blijft afgeschermd (migratie 073); de cron draait als
-- postgres en mag hem aanroepen.

DO $$
DECLARE _jid bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sluit-verlopen-inwerktrajecten-dagelijks') THEN
    PERFORM cron.unschedule('sluit-verlopen-inwerktrajecten-dagelijks');
  END IF;
  _jid := cron.schedule('sluit-verlopen-inwerktrajecten-dagelijks', '0 3 * * *', 'SELECT public.sluit_verlopen_inwerktrajecten();');
END $$;
