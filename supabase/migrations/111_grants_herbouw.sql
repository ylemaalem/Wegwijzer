-- 111_grants_herbouw.sql
-- Inhaalmigratie voor de Supabase-wijziging van 30 oktober 2026 (nieuwe tabellen krijgen geen
-- automatische API-rechten meer). Doel: de database kan weer uit de migratiebestanden worden
-- herbouwd (supabase db reset, nieuw project, preview-branch).
-- Op productie verandert hier NIETS: deze rechten bestaan al via de Supabase-standaard.
-- Alleen select/insert/update/delete (geen truncate/trigger/references), nooit anon.
-- Rechtenwijzigingen (anon intrekken e.d.) horen NIET in deze migratie.
-- Bron: live rechten en code-analyse van 25 oktober 2026.

-- 1. Tabellen die de app (ingelogde gebruiker, met RLS) gebruikt
grant select, insert, update, delete on public.aanvragen to authenticated;
grant select, insert, update, delete on public.app_feedback to authenticated;
grant select, insert, update, delete on public.document_aanvragen_beheer to authenticated;
grant select, insert, update, delete on public.document_mappen to authenticated;
grant select, insert, update, delete on public.functie_historie to authenticated;
grant select, insert, update, delete on public.onboarding_checklist to authenticated;
grant select, insert, update, delete on public.privacy_verzoeken to authenticated;
grant select, insert, update, delete on public.quiz_resultaten to authenticated;
grant select, insert, update, delete on public.rapporten to authenticated;
grant select, insert, update, delete on public.tenants to authenticated;
grant select, insert, update, delete on public.vertrouwens_scores to authenticated;
grant select, insert, update, delete on public.audit_log to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.document_aanvragen to authenticated;
grant select, insert, update, delete on public.document_chunks to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.functiegroepen to authenticated;
grant select, insert, update, delete on public.kennisbank_items to authenticated;
grant select, insert, update, delete on public.kennisnotities to authenticated;
grant select, insert, update, delete on public.kennissuggesties to authenticated;
grant select, insert, update, delete on public.meldingen to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.settings to authenticated;
grant select, insert, update, delete on public.studytube_cursussen to authenticated;
grant select, insert, update, delete on public.teamleiders to authenticated;
grant select, insert, update, delete on public.terugblik_log to authenticated;
grant select, insert, update, delete on public.toegestane_websites to authenticated;
grant select, insert, update, delete on public.trendanalyse_rapporten to authenticated;
grant select, insert, update, delete on public.weekstart_briefings to authenticated;

-- 2. Tabellen die de server (service_role, Edge Functions) gebruikt
grant select, insert, update, delete on public.audit_log to service_role;
grant select, insert, update, delete on public.conversations to service_role;
grant select, insert, update, delete on public.document_aanvragen to service_role;
grant select, insert, update, delete on public.document_chunks to service_role;
grant select, insert, update, delete on public.documents to service_role;
grant select, insert, update, delete on public.functiegroepen to service_role;
grant select, insert, update, delete on public.kennisbank_items to service_role;
grant select, insert, update, delete on public.kennisnotities to service_role;
grant select, insert, update, delete on public.kennissuggesties to service_role;
grant select, insert, update, delete on public.meldingen to service_role;
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.push_subscriptions to service_role;
grant select, insert, update, delete on public.settings to service_role;
grant select, insert, update, delete on public.studytube_cursussen to service_role;
grant select, insert, update, delete on public.teamleiders to service_role;
grant select, insert, update, delete on public.terugblik_log to service_role;
grant select, insert, update, delete on public.toegestane_websites to service_role;
grant select, insert, update, delete on public.trendanalyse_rapporten to service_role;
grant select, insert, update, delete on public.weekstart_briefings to service_role;
grant select, insert, update, delete on public.incident_naam_ontsluiting to service_role;
grant select, insert, update, delete on public.push_log to service_role;
grant select, insert, update, delete on public.rate_extensions to service_role;
grant select, insert, update, delete on public.aanvragen to service_role;
grant select, insert, update, delete on public.app_feedback to service_role;
grant select, insert, update, delete on public.document_aanvragen_beheer to service_role;
grant select, insert, update, delete on public.document_mappen to service_role;
grant select, insert, update, delete on public.functie_historie to service_role;
grant select, insert, update, delete on public.onboarding_checklist to service_role;
grant select, insert, update, delete on public.privacy_verzoeken to service_role;
grant select, insert, update, delete on public.quiz_resultaten to service_role;
grant select, insert, update, delete on public.rapporten to service_role;
grant select, insert, update, delete on public.tenants to service_role;
grant select, insert, update, delete on public.vertrouwens_scores to service_role;
grant select, insert, update, delete on public.fgl_diagnostics to service_role;
grant select, insert, update, delete on public.regressie_runs to service_role;
grant select, insert, update, delete on public.regressie_vragen to service_role;
grant select, insert, update, delete on public.response_cache to service_role;
grant select, insert, update, delete on public.uitnodigingen to service_role;
-- registreer_kenniskloof (SECURITY INVOKER) wordt door de chatfunctie als service_role aangeroepen
-- en schrijft in kenniskloof_meldingen; zonder deze GRANT faalt dat na een herbouw.
grant select, insert, update, delete on public.kenniskloof_meldingen to service_role;

-- 3. Tabellen die al een GRANT hadden maar zonder service_role: zie regel hierboven (fgl_diagnostics,
--    regressie_runs, regressie_vragen, response_cache, uitnodigingen).
-- 4. Bewust zonder rol (alleen via SECURITY DEFINER-functies of SQL):
-- geen-grant: blinde_testvragen alleen via SQL en SECURITY DEFINER-functies (regressie)
-- geen-grant: private_config alleen via SECURITY DEFINER-functies (cron-sleutels)
-- geen-grant: superadmins alleen via SECURITY DEFINER-functies (rolcontrole)

-- 5. Functies die in productie bestaan maar niet in de migraties stonden (letterlijk de live definitie)
CREATE OR REPLACE FUNCTION public.increment_gebruikt_count(doc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.documents SET gebruikt_count = COALESCE(gebruikt_count, 0) + 1 WHERE id = doc_id;
END;
$function$;
-- Zoals live: alleen service_role (bij een herbouw zou PUBLIC anders EXECUTE houden).
revoke execute on function public.increment_gebruikt_count(uuid) from public, anon, authenticated;
grant execute on function public.increment_gebruikt_count(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.seed_nieuwe_tenant(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Standaard functiegroepen (generieke zorgsector)
  INSERT INTO public.functiegroepen (tenant_id, code, naam, beschrijving, is_kantoor)
  VALUES
    (p_tenant_id, 'zorgmedewerker', 'Zorgmedewerker', 'Verleent zorg en ondersteuning aan cliënten. Werkt zelfstandig of in teamverband.', false),
    (p_tenant_id, 'begeleider', 'Begeleider', 'Begeleidt cliënten bij dagelijkse activiteiten en zelfredzaamheid.', false),
    (p_tenant_id, 'persoonlijk_begeleider', 'Persoonlijk Begeleider', 'Regiehouder over cliënten. Bewaakt zorgplannen, indicaties en doelen.', false),
    (p_tenant_id, 'medewerker_avond_nacht', 'Medewerker Avond-/Nachtdienst', 'Werkt in avond- en nachtdiensten. Focus op veiligheid en continuïteit van zorg.', false),
    (p_tenant_id, 'stagiaire', 'Stagiaire', 'Leert en oriënteert zich binnen de organisatie. Heeft extra begeleiding nodig.', false),
    (p_tenant_id, 'zzp_uitzendkracht', 'ZZP / Uitzendkracht', 'Flexibel inzetbaar, werkt mogelijk in wisselende teams of locaties.', false),
    (p_tenant_id, 'hr_medewerker', 'HR Medewerker', 'Verantwoordelijk voor personeelszaken, werving en selectie.', true),
    (p_tenant_id, 'manager', 'Manager', 'Leidinggevende met verantwoordelijkheid over afdeling of team.', true),
    (p_tenant_id, 'overig_kantoor', 'Overig Kantoor', 'Ondersteunt de organisatie bij administratieve en organisatorische taken.', true)
  ON CONFLICT DO NOTHING;

  -- Standaard document mappen
  INSERT INTO public.document_mappen (tenant_id, naam)
  VALUES
    (p_tenant_id, 'Protocollen'),
    (p_tenant_id, 'Personeelszaken'),
    (p_tenant_id, 'Organisatie'),
    (p_tenant_id, 'Handboeken'),
    (p_tenant_id, 'Zorgdocumenten')
  ON CONFLICT DO NOTHING;
END;
$function$;
-- Zoals live: alleen service_role (bij een herbouw zou PUBLIC anders EXECUTE houden).
revoke execute on function public.seed_nieuwe_tenant(uuid) from public, anon, authenticated;
grant execute on function public.seed_nieuwe_tenant(uuid) to service_role;
