-- Functie: sluit verlopen inwerktrajecten automatisch af
CREATE OR REPLACE FUNCTION sluit_verlopen_inwerktrajecten()
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE profiles
  SET
    inwerktraject_actief = false,
    inwerken_afgerond = true
  WHERE
    inwerktraject_actief = true
    AND startdatum IS NOT NULL
    AND startdatum <= NOW() - INTERVAL '42 days';
END;
$$;

-- Dagelijkse cron: handmatig in te stellen via Supabase Dashboard > Database > Cron Jobs
-- Job naam: sluit-verlopen-inwerktrajecten
-- Schedule: 0 3 * * *
-- Command: SELECT sluit_verlopen_inwerktrajecten()
