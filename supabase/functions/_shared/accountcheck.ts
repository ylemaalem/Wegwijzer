// Mag een bestaand account bij (opnieuw) uitnodigen verwijderd worden?
//
// Het verwijderen van een auth-gebruiker neemt via ON DELETE CASCADE het profiel,
// de gesprekken, de functiehistorie, persoonlijke documenten, scores en meer mee.
// Daarom (besluit Younes, 2026-10-17): alleen verwijderen als de persoon nog nooit
// is ingelogd én er geen profiel en geen gesprekken zijn. In alle andere gevallen
// wordt niets verwijderd en krijgt de beheerder een duidelijke melding.
// Getest met: node --test tests/*.test.js

export interface AuthGebruiker {
  id: string;
  last_sign_in_at?: string | null;
}

export interface Profiel {
  id: string;
  tenant_id: string;
  eerste_login_op?: string | null;
  laatste_actief?: string | null;
}

export type AccountBesluit =
  // Geen account: gewoon uitnodigen.
  | { actie: "nieuw" }
  // Nooit ingelogd, geen profiel, geen gesprekken: verwijderen is veilig.
  | { actie: "verwijderen" }
  // Openstaande uitnodiging in de eigen organisatie (profiel, nooit ingelogd):
  // de uitnodiging opnieuw sturen zonder iets te verwijderen.
  | { actie: "opnieuw_sturen"; profiel: Profiel }
  // Account in gebruik in de eigen organisatie: niets verwijderen.
  | { actie: "in_gebruik"; profiel: Profiel | null; laatstIngelogd: string | null }
  // Account hoort bij een andere organisatie: niets verwijderen, niets sturen.
  | { actie: "andere_organisatie" };

export function beoordeelBestaandAccount(
  authGebruiker: AuthGebruiker | null,
  profielen: Profiel[],
  aantalGesprekken: number,
  tenantId: string,
): AccountBesluit {
  if (!authGebruiker) return { actie: "nieuw" };

  if (profielen.some((p) => p.tenant_id !== tenantId)) return { actie: "andere_organisatie" };

  const eigenProfiel = profielen[0] ?? null;
  const laatstIngelogd = authGebruiker.last_sign_in_at
    || eigenProfiel?.laatste_actief
    || eigenProfiel?.eerste_login_op
    || null;
  if (laatstIngelogd || aantalGesprekken > 0) {
    return { actie: "in_gebruik", profiel: eigenProfiel, laatstIngelogd };
  }

  if (eigenProfiel) return { actie: "opnieuw_sturen", profiel: eigenProfiel };
  return { actie: "verwijderen" };
}

function datumNl(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
}

// Melding voor de beheerder als er niets verwijderd is.
export function meldingVoorBeheerder(besluit: AccountBesluit, soort: "uitnodigen" | "opnieuw"): string {
  switch (besluit.actie) {
    case "in_gebruik": {
      const wanneer = datumNl(besluit.laatstIngelogd);
      return `Voor dit e-mailadres bestaat al een account dat in gebruik is${wanneer ? ` (laatst actief op ${wanneer})` : ""}. ` +
        "Er is niets verwijderd. Nieuw wachtwoord nodig? Gebruik 🔑 Reset in de medewerkerslijst, of 'Wachtwoord vergeten' op het inlogscherm.";
    }
    case "andere_organisatie":
      return "Dit e-mailadres hoort al bij een account van een andere organisatie. Er is niets verwijderd en er is geen e-mail verstuurd.";
    case "opnieuw_sturen":
      return soort === "uitnodigen"
        ? "Voor dit e-mailadres staat al een uitnodiging open (nog niet ingelogd). Er is niets verwijderd. Gebruik 📨 Uitnodiging bij deze persoon om de uitnodiging opnieuw te sturen."
        : "";
    default:
      return "";
  }
}
