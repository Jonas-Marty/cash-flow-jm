import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Markdown } from "@/components/Markdown";
import { useI18n, type Lang } from "@/i18n";
import { helpUrl } from "@/lib/helpUrl";
import { Shield, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy / GDPR — Cashflow" },
      { name: "description", content: "Privacy policy and GDPR / DSGVO notice for this Cashflow instance." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrivacyPage,
});

type Section = { id: string; title: string; body: string };
type Content = {
  title: string;
  updated: string;
  intro: string;
  warning: string;
  sections: Section[];
};

const EN: Content = {
  title: "Privacy Policy & GDPR / DSGVO Notice",
  updated: "Last updated: 2026-09-22",
  intro:
    "This document explains how personal data is processed in this self-hosted Cashflow instance, in line with the EU General Data Protection Regulation (GDPR) and the Swiss Federal Act on Data Protection (FADP / revDSG).",
  warning:
    "**Important:** This instance is hosted on a private homelab server in Switzerland. Data is stored **unencrypted** at rest. The server operator has full technical access and can read every piece of information you enter. Do not use this instance to store information you are not comfortable with the operator seeing.",
  sections: [
    {
      id: "controller",
      title: "1. Data controller",
      body: "This instance is operated by a private individual (Jonas Marty) on personal infrastructure located in Switzerland. The operator is the data controller within the meaning of Art. 4 (7) GDPR. Contact for privacy matters: via the GitHub repository linked at the bottom of this page.",
    },
    {
      id: "scope",
      title: "2. Scope",
      body: "This notice applies to all personal data processed through this specific instance of the Cashflow application (the URL where you read this page). The open-source software itself is published at https://github.com/Jonas-Marty/cash-flow-jm — anyone running their own copy is the controller for their own instance.",
    },
    {
      id: "data-collected",
      title: "3. Data we collect",
      body: "**Account data:** email address and a hashed password.\n\n**Application data:** everything you enter into the app — accounts, transactions, amounts, descriptions, notes, tags, attachments, recurring rules, scopes, IOUs, settings.\n\n**Location data (opt-in, off by default):** if you switch on *Capture location* in Settings, a transaction can carry GPS coordinates, an accuracy radius in metres, a place label and how the point was obtained (device, map pin or search). Coordinates are stored to six decimal places, which is precise to roughly a handbreadth. The same fields can be sent by an API client alongside an imported transaction.\n\n**Operational data:** request logs (timestamp, request id, HTTP method, path, status, duration, best-effort user id), audit logs of database changes, authentication events (login / logout / token refresh).\n\nNo tracking cookies, no analytics SDKs, no advertising identifiers.",
    },
    {
      id: "purpose",
      title: "4. Purpose & legal basis",
      body: "- **Providing the service** (Art. 6 (1) (b) GDPR — contract): storing your transactions so the app works.\n- **Operating & securing the service** (Art. 6 (1) (f) GDPR — legitimate interest): request logs and audit logs for debugging, abuse prevention and accountability.\n- **Authentication** (Art. 6 (1) (b) GDPR): email + password to identify you across sessions.",
    },
    {
      id: "storage",
      title: "5. Storage location & security",
      body: "Data is stored on a private homelab server physically located in Switzerland. It is **not** stored on a commercial cloud provider.\n\n**Encryption at rest is NOT enabled** on the database. The operator can technically read all stored data. Network traffic between you and the server is protected by TLS (HTTPS). Access to the server is restricted to the operator.\n\nNo guarantees of availability, durability or backup frequency are made. Treat this instance as best-effort.",
    },
    {
      id: "sharing",
      title: "6. Sharing with third parties",
      body: "Your data is **not sold** and **not shared** with third parties for marketing or profiling, and no third party receives your transactions, amounts or balances.\n\n**You trigger these yourself:**\n- Connecting Nextcloud for attachments (the file stays in **your** Nextcloud; this app only stores a link to it).\n- Configuring an AI connection — see section 6a for exactly what each feature sends.\n- Using the public REST API with your own tokens.\n- Exporting your data.\n\n**These happen without a separate confirmation**, because they are part of a feature you switched on. They are listed here rather than left implied:\n\n| Service | Called by | Receives | When |\n| --- | --- | --- | --- |\n| [Nominatim](https://nominatim.openstreetmap.org) (OpenStreetMap) | our server | your search text, or the exact coordinates of a pin | every place search, and every time a location is captured or moved |\n| [Photon](https://photon.komoot.io) (Komoot) | our server | the same, as a fallback when Nominatim fails | as above |\n| [tile.openstreetmap.org](https://tile.openstreetmap.org) | **your browser** | **your IP address** and the map area shown | whenever a map is displayed |\n| [api.frankfurter.dev](https://api.frankfurter.dev) (ECB rates) | **your browser** | **your IP address**; no account data | on the dashboard, Envelopes and Add, when you hold more than one currency |\n| [unpkg.com](https://unpkg.com) | **your browser** | **your IP address** | only if you open the API documentation page |\n| [openstreetmap.org](https://www.openstreetmap.org) | **your browser** | **your IP address** and the coordinates, in the link | only if you click *open in OpenStreetMap* |\n\nThe two geocoding lookups are made **by the server on your behalf**, so OpenStreetMap and Komoot see this server\u2019s address rather than yours. The four browser-side rows do expose your own IP address to the service named.\n\nNo other processors are used, and none of these receive financial data.",
    },
    {
      id: "ai",
      title: "6a. Optional AI assistant",
      body: "If you set up an AI connection in Settings, the following additional processing happens:\n\n- **You bring your own provider.** You configure one or more OpenAI-compatible connections (endpoint, model, API token). Nothing is sent anywhere until you do. Each feature below uses the connection you assign to it under *AI action assignment* — and, optionally, a specific model on that connection — or, unassigned, the enabled connection with the highest priority.\n- **Token storage.** API tokens are stored **server-side** in the `ai_endpoints` table on the same Swiss homelab server. They are **never** returned to the browser. **The server operator can technically read stored tokens** because the database is not encrypted at rest — treat them like any other credential on this instance and use tokens scoped to the minimum permissions you need.\n- **What is sent to your provider, per feature.**\n  - *Assistant chat:* your messages, a snapshot of your accounts, categories and recent activity (how much is set per connection under *Context*), plus the results of any read tool the model decides to call (transactions, balances, category totals, open IOUs, account names, help-page snippets).\n  - *Statement extraction:* the bank statement you upload (PDF or image), page by page.\n  - *Statement line classification:* the extracted rows that could not be matched to an existing transaction, with the same data snapshot, so the model can propose a description, category and tags.\n  - *Pending transactions:* rows that reach `/pending` without a category — including the **raw notification text** a capturing device attached, plus amount, date, account name and place name — with the same data snapshot. This runs automatically when such a row arrives and is retried when a connection comes online.\n  - *Voice input:* the audio you record in the chat, sent to the transcription model of the connection assigned to voice input.\n\n  The operator of that endpoint sees this data — choose a provider you trust (e.g. a local Ollama instance on your own machine if you want zero external sharing).\n- **No automatic writes to your books.** The assistant can only **prepare a draft** for the Add-Transaction form, and the classification passes only fill **suggestion fields** on statement lines and pending rows. Nothing becomes a transaction without your action.\n- **Activity log.** Every request to a provider is recorded in the `ai_audit_logs` table on this instance: kind, model, provider host, duration, token counts and a short preview of the response — never the token itself.\n- **Scope.** The system prompt restricts the assistant to personal-finance, app-usage and privacy questions. Off-topic questions are refused.\n- **Disable any time** by disabling or deleting the connections in Settings.",
    },
    {
      id: "retention",
      title: "7. Retention",
      body: "- **Application data:** kept until you delete it or request deletion of your account.\n- **Audit logs:** retained for up to 365 days, then pruned.\n- **Request logs:** kept for the lifetime of the running container's log driver (typically a few weeks).",
    },
    {
      id: "rights",
      title: "8. Your rights under GDPR / DSGVO",
      body: "You have the right to:\n- **Access** (Art. 15) — get a copy of your data.\n- **Rectification** (Art. 16) — correct inaccurate data; you can do this yourself in the app.\n- **Erasure** (Art. 17) — request deletion of your data and account.\n- **Restriction** (Art. 18) and **Objection** (Art. 21) — limit or object to processing.\n- **Portability** (Art. 20) — receive your data in a machine-readable format.\n- **Withdraw consent** at any time, with effect for the future.\n- **Lodge a complaint** with a supervisory authority (in Switzerland: the FDPIC / EDÖB; in the EU: your national DPA).\n\nTo exercise any of these rights, contact the operator via the GitHub repository.",
    },
    {
      id: "self-host",
      title: "9. Run your own instance",
      body: "If you would prefer to keep full control of your data, the project is open source. You can self-host: https://github.com/Jonas-Marty/cash-flow-jm — the README explains how to build and how to deploy against your own Supabase instance.",
    },
    {
      id: "changes",
      title: "10. Changes to this notice",
      body: "This notice may be updated as the application evolves. The current version is always available at /privacy. Material changes will be announced in-app where reasonably possible.",
    },
  ],
};

const DE: Content = {
  title: "Datenschutzerklärung & DSGVO-Hinweis",
  updated: "Stand: 2026-09-22",
  intro:
    "Dieses Dokument beschreibt, wie personenbezogene Daten in dieser selbst gehosteten Cashflow-Instanz verarbeitet werden — im Sinne der EU-Datenschutz-Grundverordnung (DSGVO) und des revidierten Schweizer Datenschutzgesetzes (revDSG).",
  warning:
    "**Wichtig:** Diese Instanz läuft auf einem privaten Homelab-Server in der Schweiz. Die Daten werden **unverschlüsselt** gespeichert. Die betreibende Person hat vollen technischen Zugriff und kann alle eingegebenen Informationen lesen. Verwende diese Instanz nicht für Informationen, deren Einsicht durch die betreibende Person du nicht akzeptierst.",
  sections: [
    {
      id: "controller",
      title: "1. Verantwortliche Stelle",
      body: "Diese Instanz wird von einer Einzelperson (Jonas Marty) auf privater Infrastruktur in der Schweiz betrieben. Die betreibende Person ist verantwortliche Stelle im Sinne von Art. 4 Nr. 7 DSGVO. Kontakt in Datenschutzfragen: über das am Seitenende verlinkte GitHub-Repository.",
    },
    {
      id: "scope",
      title: "2. Geltungsbereich",
      body: "Dieser Hinweis gilt für alle personenbezogenen Daten, die über diese konkrete Instanz der Cashflow-Anwendung verarbeitet werden (die URL, unter der du diese Seite liest). Die Open-Source-Software selbst ist unter https://github.com/Jonas-Marty/cash-flow-jm verfügbar — wer eine eigene Kopie betreibt, ist für seine Instanz selbst verantwortlich.",
    },
    {
      id: "data-collected",
      title: "3. Erhobene Daten",
      body: "**Account-Daten:** E-Mail-Adresse und gehashtes Passwort.\n\n**Anwendungsdaten:** alles, was du in der App eingibst — Konten, Buchungen, Beträge, Beschreibungen, Notizen, Tags, Anhänge, wiederkehrende Regeln, Scopes, IOUs, Einstellungen.\n\n**Standortdaten (opt-in, standardmäßig aus):** Wenn du in den Einstellungen *Ort erfassen* aktivierst, kann eine Buchung GPS-Koordinaten, einen Genauigkeitsradius in Metern, eine Ortsbezeichnung und die Herkunft des Punktes (Gerät, Karten-Pin oder Suche) tragen. Koordinaten werden mit sechs Nachkommastellen gespeichert, also etwa handbreit genau. Dieselben Felder kann auch ein API-Client zu einer importierten Buchung mitschicken.\n\n**Betriebsdaten:** Request-Logs (Zeitstempel, Request-ID, HTTP-Methode, Pfad, Status, Dauer, sofern möglich User-ID), Audit-Logs von Datenbankänderungen, Authentifizierungsereignisse (Login / Logout / Token-Refresh).\n\nKeine Tracking-Cookies, keine Analytics-SDKs, keine Werbe-IDs.",
    },
    {
      id: "purpose",
      title: "4. Zweck & Rechtsgrundlage",
      body: "- **Bereitstellung des Dienstes** (Art. 6 Abs. 1 lit. b DSGVO — Vertrag): Speicherung deiner Buchungen, damit die App funktioniert.\n- **Betrieb & Sicherheit** (Art. 6 Abs. 1 lit. f DSGVO — berechtigtes Interesse): Request- und Audit-Logs zur Fehlersuche, Missbrauchsvermeidung und Nachvollziehbarkeit.\n- **Authentifizierung** (Art. 6 Abs. 1 lit. b DSGVO): E-Mail + Passwort zur Wiedererkennung über Sitzungen hinweg.",
    },
    {
      id: "storage",
      title: "5. Speicherort & Sicherheit",
      body: "Die Daten werden auf einem privaten Homelab-Server in der Schweiz gespeichert. Sie liegen **nicht** bei einem kommerziellen Cloud-Anbieter.\n\n**Eine Verschlüsselung im Ruhezustand (encryption at rest) ist NICHT aktiviert.** Die betreibende Person kann technisch sämtliche gespeicherten Daten einsehen. Der Netzwerkverkehr zwischen dir und dem Server ist per TLS (HTTPS) geschützt. Der Serverzugriff ist auf die betreibende Person beschränkt.\n\nEs werden keine Zusicherungen zu Verfügbarkeit, Beständigkeit oder Backup-Frequenz gemacht. Behandle diese Instanz als Best-Effort-Angebot.",
    },
    {
      id: "sharing",
      title: "6. Weitergabe an Dritte",
      body: "Deine Daten werden **nicht verkauft** und **nicht für Marketing oder Profilbildung** an Dritte weitergegeben. Kein Dritter erhält deine Buchungen, Beträge oder Salden.\n\n**Das löst du selbst aus:**\n- Verbinden von Nextcloud für Anhänge (die Datei bleibt in **deiner** Nextcloud; diese App speichert nur einen Link darauf).\n- Einrichten einer KI-Verbindung — was dabei genau gesendet wird, steht in Abschnitt 6a.\n- Nutzung der öffentlichen REST-API mit eigenen Tokens.\n- Export deiner Daten.\n\n**Das geschieht ohne gesonderte Rückfrage**, weil es zu einer von dir aktivierten Funktion gehört. Es wird hier aufgeführt, statt stillschweigend vorausgesetzt:\n\n| Dienst | Aufgerufen von | Erhält | Wann |\n| --- | --- | --- | --- |\n| [Nominatim](https://nominatim.openstreetmap.org) (OpenStreetMap) | unserem Server | deinen Suchtext bzw. die exakten Koordinaten eines Pins | bei jeder Ortssuche und jedes Mal, wenn ein Ort erfasst oder verschoben wird |\n| [Photon](https://photon.komoot.io) (Komoot) | unserem Server | dasselbe, als Fallback wenn Nominatim ausfällt | wie oben |\n| [tile.openstreetmap.org](https://tile.openstreetmap.org) | **deinem Browser** | **deine IP-Adresse** und den gezeigten Kartenausschnitt | sobald eine Karte angezeigt wird |\n| [api.frankfurter.dev](https://api.frankfurter.dev) (EZB-Kurse) | **deinem Browser** | **deine IP-Adresse**; keine Kontodaten | auf Übersicht, Budgets und Neu, wenn du mehr als eine Währung führst |\n| [unpkg.com](https://unpkg.com) | **deinem Browser** | **deine IP-Adresse** | nur wenn du die API-Dokumentation öffnest |\n| [openstreetmap.org](https://www.openstreetmap.org) | **deinem Browser** | **deine IP-Adresse** und die Koordinaten im Link | nur wenn du *in OpenStreetMap öffnen* anklickst |\n\nDie beiden Geocoding-Abfragen stellt **der Server stellvertretend für dich**, OpenStreetMap und Komoot sehen also die Adresse dieses Servers und nicht deine. Bei den vier browserseitigen Zeilen wird deine eigene IP-Adresse dem genannten Dienst bekannt.\n\nWeitere Auftragsverarbeiter werden nicht eingesetzt, und keiner der genannten Dienste erhält Finanzdaten.",
    },
    {
      id: "ai",
      title: "6a. Optionaler KI-Assistent",
      body: "Wenn du in den Einstellungen eine KI-Verbindung einrichtest, kommen folgende zusätzliche Verarbeitungen hinzu:\n\n- **Bring deinen eigenen Provider mit.** Du konfigurierst eine oder mehrere OpenAI-kompatible Verbindungen (Endpoint, Modell, API-Token). Ohne diese Eingaben wird nichts versendet. Jede Funktion unten nutzt die Verbindung, die du ihr unter *Zuordnung der KI-Aktionen* zuweist — dort optional auch ein bestimmtes Modell dieser Verbindung — ohne Zuordnung die aktivierte Verbindung mit der höchsten Priorität.\n- **Token-Speicherung.** API-Tokens werden **serverseitig** in der Tabelle `ai_endpoints` auf demselben Schweizer Homelab-Server gespeichert. Sie werden **nie** an den Browser zurückgegeben. **Die betreibende Person kann gespeicherte Tokens technisch lesen**, weil die Datenbank nicht verschlüsselt ist — behandle sie wie andere Zugangsdaten auf dieser Instanz und verwende Tokens mit minimal nötigen Rechten.\n- **Was an den Provider gesendet wird, pro Funktion.**\n  - *Assistent-Chat:* deine Nachrichten, ein Schnappschuss deiner Konten, Kategorien und letzten Aktivität (Umfang pro Verbindung unter *Kontext* einstellbar) sowie die Ergebnisse der Lesetools, die das Modell aufruft (Buchungen, Kontostände, Kategoriesummen, offene IOUs, Kontonamen, Hilfeauszüge).\n  - *Auszug auslesen:* der hochgeladene Kontoauszug (PDF oder Bild), Seite für Seite.\n  - *Auszugszeilen klassifizieren:* die ausgelesenen Zeilen, die keiner bestehenden Buchung zugeordnet werden konnten, mit demselben Daten-Schnappschuss, damit das Modell Beschreibung, Kategorie und Tags vorschlagen kann.\n  - *Offene Buchungen:* Zeilen, die ohne Kategorie in `/pending` ankommen — einschließlich des **Rohtexts der Benachrichtigung**, den ein erfassendes Gerät mitgeschickt hat, sowie Betrag, Datum, Kontoname und Ortsname — mit demselben Daten-Schnappschuss. Das läuft automatisch, sobald eine solche Zeile eintrifft, und wird nachgeholt, wenn eine Verbindung online kommt.\n  - *Spracheingabe:* die im Chat aufgenommene Audioaufnahme, gesendet an das Transkriptionsmodell der für Spracheingabe zugewiesenen Verbindung.\n\n  Der Betreiber dieses Endpoints sieht diese Daten — wähle einen Provider, dem du vertraust (z. B. lokale Ollama-Instanz, wenn nichts nach außen soll).\n- **Keine automatischen Schreibvorgänge in deine Bücher.** Der Assistent kann nur **einen Entwurf** für das Add-Formular vorbereiten, und die Klassifizierungsläufe füllen nur **Vorschlagsfelder** an Auszugszeilen und offenen Buchungen. Nichts wird ohne dein Zutun zur Buchung.\n- **Aktivitätsprotokoll.** Jede Anfrage an einen Provider wird in der Tabelle `ai_audit_logs` auf dieser Instanz festgehalten: Art, Modell, Provider-Host, Dauer, Token-Zahlen und eine kurze Vorschau der Antwort — nie der Token selbst.\n- **Themen-Beschränkung.** Der System-Prompt erlaubt nur Themen rund um persönliche Finanzen, App-Bedienung und Datenschutz. Anderes wird abgelehnt.\n- **Jederzeit deaktivierbar**, indem du die Verbindungen in den Einstellungen deaktivierst oder löschst.",
    },
    {
      id: "retention",
      title: "7. Aufbewahrung",
      body: "- **Anwendungsdaten:** bis zu deiner Löschung bzw. einem Löschantrag.\n- **Audit-Logs:** bis zu 365 Tage, danach automatisch entfernt.\n- **Request-Logs:** abhängig vom Log-Driver des Containers (typischerweise wenige Wochen).",
    },
    {
      id: "rights",
      title: "8. Deine Rechte nach DSGVO / revDSG",
      body: "Du hast das Recht auf:\n- **Auskunft** (Art. 15) — Kopie deiner Daten.\n- **Berichtigung** (Art. 16) — Korrektur unrichtiger Daten; in der App selbst möglich.\n- **Löschung** (Art. 17) — Löschung deiner Daten und deines Accounts.\n- **Einschränkung** (Art. 18) und **Widerspruch** (Art. 21) — Verarbeitung einschränken oder ihr widersprechen.\n- **Datenübertragbarkeit** (Art. 20) — Erhalt deiner Daten in maschinenlesbarem Format.\n- **Widerruf einer Einwilligung** jederzeit mit Wirkung für die Zukunft.\n- **Beschwerde bei einer Aufsichtsbehörde** (Schweiz: EDÖB; EU: zuständige nationale Behörde).\n\nKontakt zur Wahrnehmung dieser Rechte: über das GitHub-Repository.",
    },
    {
      id: "self-host",
      title: "9. Eigene Instanz betreiben",
      body: "Wenn du die volle Kontrolle über deine Daten behalten möchtest, ist das Projekt Open Source. Du kannst es selbst hosten: https://github.com/Jonas-Marty/cash-flow-jm — die README beschreibt Build und Deployment gegen eine eigene Supabase-Instanz.",
    },
    {
      id: "changes",
      title: "10. Änderungen an diesem Hinweis",
      body: "Dieser Hinweis kann mit Weiterentwicklung der Anwendung angepasst werden. Die aktuelle Fassung ist jederzeit unter /privacy abrufbar. Wesentliche Änderungen werden, soweit zumutbar, in der App angekündigt.",
    },
  ],
};

const CONTENT: Record<Lang, Content> = { en: EN, de: DE };

function PrivacyPage() {
  const { lang } = useI18n();
  const c = CONTENT[lang] ?? CONTENT.en;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Shield className="h-6 w-6 text-primary" />
          {c.title}
        </h1>
        <p className="text-xs text-muted-foreground">{c.updated}</p>
        <p className="text-sm text-muted-foreground">{c.intro}</p>
      </header>

      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="flex gap-3 py-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="text-sm">
            <Markdown>{c.warning}</Markdown>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="hidden lg:block">
          <div className="sticky top-20 space-y-1 text-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {lang === "de" ? "Auf dieser Seite" : "On this page"}
            </div>
            {c.sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {s.title}
              </a>
            ))}
          </div>
        </nav>

        <div className="space-y-4">
          {c.sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-20">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{s.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Markdown>{s.body}</Markdown>
                </CardContent>
              </Card>
            </section>
          ))}

          <Separator />
          <p className="text-center text-xs text-muted-foreground">
            <a href={helpUrl(lang)} className="hover:underline">
              ← {lang === "de" ? "Zur Hilfe" : "Back to help"}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}