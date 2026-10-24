# Werkregels voor Claude (Wegwijzer)

## Bij elke wijziging eerst
Beschrijf vóór het bouwen, kort:
1. Hoe werkt het huidige systeem als geheel (de onderdelen die geraakt worden)?
2. Wat lost deze wijziging op?
3. Welke nieuwe risico's ontstaan er?
4. Hoe werken de onderdelen erna samen?
5. Welke randgevallen zijn er?
6. Is het netto beter dan de basis (gemeten, niet aangenomen)?

## Werkwijze
- Eén wijziging tegelijk. Volledige regressietest vóór en na; meld het aantal geslaagde vragen en welke vragen veranderen. Een omgevallen vraag 3× herhalen.
- Geen pleisters: zoek de oorzaak. Kennisnotities alleen voor wat niet op papier staat, nooit om zoekproblemen te omzeilen.
- Testdefinities niet zelf versoepelen; stel varianten voor en wacht op akkoord.
- Niets uit productie verwijderen zonder akkoord. Stop alleen bij productiedata of onomkeerbare wijzigingen.
- Stop ook als een bestaande rechtenregel (RLS, rollen, toegang) moet worden gewijzigd: beschrijf de wijziging en wacht op akkoord.
- Plaats geen belofte over privacy of toegang in een tekst (welkomsttekst, handleiding, privacyverklaring) zonder te controleren dat de code die belofte afdwingt en vastlegt.
- Productie = main. Vergelijk de live functie met de code vóór elke deploy.

## Kosten
- De volledige regressieset maximaal 1 keer vóór en 1 keer ná een wijziging. Herhalingen alleen voor vragen die omvielen. Geen metingen met meerdere hele runs, tenzij Younes erom vraagt.
- Wijziging die alleen de voor- of achterkant raakt en niet de chatfunctie: geen regressierun.
- Meld per stap de kosten in USD. Waarschuw als de kosten op een dag boven $3 komen.

## Skills
- `supabase:supabase` en `supabase:supabase-postgres-best-practices`: bij elke wijziging aan tabellen, migraties, RLS, triggers of cron.
- `security-review`: na elke wijziging aan rollen, rechten, meldingen, auditlog of toegang tot gegevens, ook kleine.
- `code-review`: vóór het live zetten van grote wijzigingen.
- `claude-api`: om modelnamen en prijzen te controleren; nooit zelf verzinnen.
- `docx`, `pdf`, `pptx`: bij die bestandstypen.
- Geen andere skills, tenzij Younes erom vraagt.
- Meld per stap welke skills gebruikt zijn.

## Database
- Vanaf 30 oktober 2026 krijgen nieuwe tabellen in het public-schema geen automatische API-toegang. Zet in elke migratie met een nieuwe tabel, naast de RLS-regels:
  `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.<tabel> TO anon, authenticated;`
- Elke wijziging aan rechten krijgt een rechtentest in een teruggedraaide transactie (beheerder, HR, teamleider, medewerker, andere organisatie), zie `tests/sql/`.

## Deploy en verslag
- Geef bij elke deploy: commit-id, functieversie en tijdstip. Younes controleert de samenvatting zelf.
- Leg alles wat klaar is vast als samenvatting met drie delen: wat is er gedaan, wat is getest, wat is nog open.

## Geheimen
- De repo is openbaar: nooit geheimen committen.
- Younes vernieuwt tokens en sleutels zelf.
