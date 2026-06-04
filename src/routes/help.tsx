import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Markdown } from "@/components/Markdown";
import { useI18n, type Lang } from "@/i18n";
import {
  BookOpen, Compass, LayoutDashboard, ListOrdered, Plus, PiggyBank,
  LineChart, Inbox, Scale, Settings as SettingsIcon, Users, HelpCircle,
  Sparkles, Search, Shield, Github,
} from "lucide-react";
export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help & Guide — Cashflow" },
      { name: "description", content: "Learn the concepts and UI of the Cashflow app." },
    ],
  }),
  component: HelpPage,
});

// ---------------------------------------------------------------------------
// Content model
// ---------------------------------------------------------------------------

type Item = { q: string; a: string };
type Section = {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  intro?: string;
  items: Item[];
};

type Content = {
  pageTitle: string;
  pageSubtitle: string;
  searchPlaceholder: string;
  noResults: string;
  toc: string;
  sections: Section[];
};

const EN: Content = {
  pageTitle: "Help & Guide",
  pageSubtitle:
    "Everything you need to know to use Cashflow — concepts, screens, and common workflows.",
  searchPlaceholder: "Search the guide…",
  noResults: "No topics match your search.",
  toc: "On this page",
  sections: [
    {
      id: "getting-started",
      icon: Compass,
      title: "Getting started",
      intro:
        "Cashflow is a personal finance app that combines cash-flow tracking, envelope budgeting and IOU management. Here is how to get going in a few minutes.",
      items: [
        {
          q: "What is this app for?",
          a: "Track every transaction across your accounts, plan spending with monthly envelopes (budgets), keep tabs on money you owe or that's owed to you (IOUs), and review where your money goes with insights and trends.",
        },
        {
          q: "Three-minute setup",
          a: "1. Open **Settings → Accounts** and add your real-world accounts (bank, cash, credit card).\n2. In **Settings → Categories & Envelopes**, add a few categories grouped by purpose (e.g. *Living*, *Fun*, *Transport*).\n3. Tap the big **+** button to add your first transaction.\n4. Visit the **Dashboard** to see your balances, budget status and recent activity.",
        },
        {
          q: "How do I switch language or theme?",
          a: "Click your avatar in the top-right (desktop) or open **More → Settings** on mobile. Theme and language live in the avatar menu.",
        },
      ],
    },
    {
      id: "concepts",
      icon: BookOpen,
      title: "Core concepts",
      items: [
        { q: "Account", a: "A real-world container for money: a bank account, cash wallet, credit card, or savings pot. Every transaction belongs to exactly one account (transfers belong to two)." },
        { q: "Transaction", a: "A single movement of money: expense, income or transfer. Has a date, amount, account, category and optional tags, attachments and notes." },
        { q: "Category", a: "What the money was for (Groceries, Salary, Rent…). Categories are grouped, and most categories represent a monthly *envelope* you can budget." },
        { q: "Category group", a: "A bucket that groups related categories (e.g. *Food* contains Groceries, Eating out, Coffee). Used in reports and for shared sweep settings." },
        { q: "Envelope / budget", a: "The monthly amount you plan to spend in a category. The Envelopes screen shows how much is left in each envelope for the current month." },
        { q: "Scope", a: "A lens that pre-filters and pre-fills the app — for example a trip, a project, or a shared household. Switching the active scope changes the dashboard, transaction list and add-form defaults." },
        { q: "IOU / reimbursable", a: "A transaction flagged because someone owes you (or you owe someone). Open IOUs stay visible until you record a repayment, mark them settled, write them off, or cancel them." },
        { q: "Pending transaction", a: "An entry imported from outside the app (via the public API or another source) that has not yet been booked. You review it and then confirm or reject." },
        { q: "Recurring rule", a: "A template that posts a transaction on a schedule (rent, salary, subscriptions). You can skip, edit or post individual occurrences." },
        { q: "Reconciliation", a: "Comparing the app's account totals with reality. The Reconcile screen shows any drift between booked balances, savings envelopes, and unswept money." },
        { q: "Sweep / savings target", a: "At month-end, any leftover budget in an envelope can be *swept* into a savings category. You can set a default target and per-group overrides." },
        { q: "Attachment", a: "A file (receipt, invoice) linked to a transaction. Optionally synced to Nextcloud if you connect it." },
        { q: "Tag", a: "A free-form label you can attach to transactions and search by. Useful for cross-cutting concerns that don't fit categories (e.g. *vacation-2025*)." },
      ],
    },
    {
      id: "screens",
      icon: LayoutDashboard,
      title: "Screens",
      intro: "One section per main screen in the app.",
      items: [
        {
          q: "Dashboard (/)",
          a: "Your home screen. Shows account balances grouped into Assets and Liabilities, monthly budget summary, open IOUs, pending confirmations, upcoming recurring posts, top transactions of the month, a daily spend heatmap, and a trend strip. Each card is a quick jump-off to the related screen.",
        },
        {
          q: "Transactions (/transactions)",
          a: "The full transaction list. Filter by date, account, category, type, scope or tag. The amount filter supports operators like `>100`, `<=50`, `10-30` or `=42`. Tap a row to edit or delete.",
        },
        {
          q: "Add (/add)",
          a: "The form to record a new transaction. Pick type (expense / income / transfer), amount, date, account and category. Optional fields: counterparty, scope, tags, attachments, notes, and the *reimbursable* flag for IOUs. Smart suggestions pre-fill based on past entries.",
        },
        {
          q: "Envelopes (/envelopes)",
          a: "Your monthly budget view. Each envelope shows planned vs spent vs remaining. Use *Reallocate* to move budget between envelopes, and configure rollover and sweep targets in **Settings → Savings & sweeps**.",
        },
        {
          q: "Insights (/insights)",
          a: "Analytics in four tabs:\n- **Overview** — totals and net flow for the chosen period.\n- **Breakdown** — spending by category / group.\n- **Trends** — month-over-month evolution.\n- **Projection** — extrapolation based on recurring rules and recent averages.\nUse the period picker at the top to switch month / quarter / year / custom.",
        },
        {
          q: "Pending (/pending)",
          a: "Four tabs:\n- **Pending** — imported entries waiting for you to confirm or reject. Not yet booked.\n- **Open IOUs** — booked transactions you flagged as reimbursable that aren't settled yet.\n- **Rejected** — entries you rejected, kept for audit, restorable.\n- **Confirmed** — entries you already confirmed, shown for traceability. The real transaction lives in Transactions.",
        },
        {
          q: "Reconcile (/reconcile)",
          a: "Shows the difference (*drift*) between your accounts total and the sum of your savings allocations plus unswept money. When drift is zero, everything is accounted for. Use this monthly to catch missed sweeps or forgotten transfers.",
        },
        {
          q: "Scopes (/scopes)",
          a: "Create, edit and switch your scopes (trips, projects, shared households). The active scope is shown as a chip in the header and influences the dashboard, the add-form, and category defaults.",
        },
        {
          q: "Settings (/settings)",
          a: "All configuration:\n- **Accounts** — your real-world accounts.\n- **Categories & envelopes** — what you spend on and your monthly plan.\n- **Savings & sweeps** — where leftover budget goes at month-end.\n- **Recurring rules** — auto-posting transactions.\n- **API tokens** — for the public REST API.\n- **Nextcloud** — connect cloud storage for attachments.\n- **Audit log** — recent changes.\n- **Export / import** — move your data in or out (also useful for self-hosting).",
        },
      ],
    },
    {
      id: "iou-actions",
      icon: Users,
      title: "Workflow: IOUs (money you owe or are owed)",
      intro:
        "When you flag a transaction as reimbursable, it shows up as an Open IOU. There are four ways to close one:",
      items: [
        { q: "Add repayment", a: "Use when **real money actually moved**. Opens the Add form pre-filled with the open amount and counterparty, links the new transaction to the original. Once the linked amount covers the original, it auto-settles." },
        { q: "Mark as settled", a: "Use when the debt was cleared **outside the app** (cash handover, tiny rounding remainder). Closes the IOU without creating a repayment transaction. A confirmation dialog prevents accidental clicks." },
        { q: "Book as loss (write-off)", a: "Use when you accept you won't be repaid. Creates an offsetting transaction in a category you pick (e.g. *Bad debt*, *Gifts given*) so the loss shows up in your budget and reports." },
        { q: "Cancel", a: "Use when the IOU **shouldn't have existed** (mis-flagged, duplicate, voided). Removes the IOU flag entirely. No offsetting transaction is created." },
      ],
    },
    {
      id: "workflows",
      icon: Sparkles,
      title: "Common workflows",
      items: [
        {
          q: "Shared expense and getting repaid",
          a: "1. Add the expense, toggle **Reimbursable** and pick the counterparty.\n2. It appears under **Open IOUs** on the dashboard.\n3. When you receive the money, click **Add repayment** — the form is pre-filled, just save.\n4. The IOU auto-closes once fully covered. For partial or cash settlements, use *Mark as settled* or *Book as loss* instead.",
        },
        {
          q: "Importing transactions via the API",
          a: "1. In **Settings → API tokens**, create a token.\n2. POST entries to `/api/public/pending-transactions` (see Swagger UI at `/api/public/docs`).\n3. Imported entries appear in **Pending → Pending**. Review and confirm or reject.",
        },
        {
          q: "Monthly close",
          a: "1. Open **Reconcile**, fix any drift.\n2. Sweep leftover envelope balances to your savings categories.\n3. Review **Insights → Overview** and **Trends** to spot anomalies.\n4. Adjust next month's envelopes if needed.",
        },
        {
          q: "Recurring bills",
          a: "1. In **Settings → Recurring rules**, add a rule with cadence, amount and category.\n2. The dashboard's *Upcoming* card shows pending occurrences.\n3. Post, edit or skip each occurrence individually.",
        },
        {
          q: "Connecting Nextcloud",
          a: "Open **Settings → Nextcloud** and follow the OAuth flow. Once connected, attachments uploaded to transactions are stored in your Nextcloud and previewable via a file picker.",
        },
      ],
    },
    {
      id: "faq",
      icon: HelpCircle,
      title: "FAQ & troubleshooting",
      items: [
        {
          q: "An IOU I marked as settled came back after reload",
          a: "This was a known bug and is now fixed: the UI only confirms success if the database actually updated. If it still happens, take note of the transaction id and check whether the row is reachable for your user (RLS / scope).",
        },
        {
          q: "Why is my reconciliation drift not zero?",
          a: "Drift means the sum of account balances doesn't match the sum of savings buckets + unswept money. Usual causes: a transfer recorded on only one side, a transaction in a savings category that wasn't swept, or a category mis-typed as savings. Walk back through recent transactions in the affected accounts.",
        },
        {
          q: "Where do skipped recurring occurrences go?",
          a: "Nowhere — they are simply not posted. The recurring rule continues with the next scheduled date. You can always post an occurrence later from the Upcoming card.",
        },
      ],
    },
    {
      id: "data-storage",
      icon: Shield,
      title: "Data storage & privacy",
      intro:
        "Be aware where and how your data is stored before entering anything sensitive.",
      items: [
        {
          q: "Where is my data stored?",
          a: "This instance is hosted on a **private homelab server in Switzerland**, operated by an individual (not a company or cloud provider). It is not located in a commercial data center.",
        },
        {
          q: "Is my data encrypted?",
          a: "**No.** Data is currently stored **unencrypted** at rest in the database. The server operator has full technical access to the database and can read any information you enter (descriptions, amounts, notes, attachments, tags, account names, etc.).",
        },
        {
          q: "What does this mean for me?",
          a: "Only enter information you are comfortable with the server operator being able to read. Avoid storing highly sensitive data (passwords, full IBANs you wouldn't share, medical references, etc.).",
        },
        {
          q: "How is this handled legally?",
          a: "See the [Privacy Policy / GDPR notice](/privacy) — you accepted it at sign-up. It explains who the data controller is, what is stored, and your rights under GDPR / DSGVO.",
        },
        {
          q: "Can I run my own instance?",
          a: "Yes. The project is open source. See the [GitHub repository](https://github.com/Jonas-Marty/cash-flow-jm) — the README explains how to build and how to deploy against your own Supabase instance.",
        },
      ],
    },
    {
      id: "ai",
      icon: Sparkles,
      title: "AI assistant",
      intro:
        "An optional in-app assistant that uses a chat model you provide. Only personal-finance, app-usage and privacy topics are allowed.",
      items: [
        {
          q: "How do I enable it?",
          a: "Open **Settings → AI Assistant**, switch it on, paste the **API base URL** (e.g. `https://api.openai.com/v1`), the **model name** (e.g. `gpt-4o-mini`), and your **API token**. Hit *Test connection*, then *Save*.",
        },
        {
          q: "Which providers work?",
          a: "Anything that speaks the OpenAI Chat-Completions API: OpenAI, OpenRouter, Groq, Together, local **Ollama** (`http://host:11434/v1`), **LM Studio**, **vLLM**, **llama.cpp** server, etc.",
        },
        {
          q: "What can it do?",
          a: "Prefill the Add-Transaction form from a sentence like *\"I spent 50 at Coop on groceries, paid by credit card\"*; answer questions about your data (*\"where did I spend most last month?\"*) by calling read-only tools; and explain app features and the privacy notice. It will refuse any other topic.",
        },
        {
          q: "Does it write to my data?",
          a: "No. It only **prepares a draft** for the Add screen — you always review and save manually. All other tools are read-only.",
        },
        {
          q: "What is sent to my provider?",
          a: "Your messages, plus the results of any read tool the model decides to call (transactions, balances, category totals). See the [privacy page](/privacy) for the full data flow.",
        },
        {
          q: "Where is my API token stored?",
          a: "Server-side in the `ai_credentials` table. It is **not** returned to the browser, but the server operator can read it — treat it like other credentials on this instance.",
        },
      ],
    },
  ],
};

const DE: Content = {
  pageTitle: "Hilfe & Anleitung",
  pageSubtitle:
    "Alles, was du zum Einstieg in Cashflow brauchst — Konzepte, Bildschirme und typische Abläufe.",
  searchPlaceholder: "Anleitung durchsuchen…",
  noResults: "Keine Themen gefunden.",
  toc: "Auf dieser Seite",
  sections: [
    {
      id: "getting-started",
      icon: Compass,
      title: "Erste Schritte",
      intro:
        "Cashflow ist eine Finanz-App, die Cash-Flow-Tracking, Umschlag-Budgetierung und IOU-Verwaltung vereint. So legst du in wenigen Minuten los.",
      items: [
        {
          q: "Wofür ist die App?",
          a: "Erfasse jede Buchung über alle Konten hinweg, plane mit monatlichen Umschlägen (Budgets), behalte den Überblick über Geld, das du jemandem schuldest oder das dir geschuldet wird (IOUs), und sieh in Auswertungen, wohin dein Geld fließt.",
        },
        {
          q: "Drei-Minuten-Setup",
          a: "1. **Einstellungen → Konten**: trage deine echten Konten ein (Bank, Bargeld, Kreditkarte).\n2. **Einstellungen → Kategorien & Budgets**: lege Kategorien in Gruppen an (z. B. *Wohnen*, *Freizeit*, *Mobilität*).\n3. Tippe den großen **+**-Button und erfasse deine erste Buchung.\n4. Öffne die **Übersicht** für Salden, Budget-Status und letzte Aktivitäten.",
        },
        {
          q: "Sprache oder Theme wechseln?",
          a: "Klick auf dein Avatar oben rechts (Desktop) bzw. **Mehr → Einstellungen** auf dem Handy. Theme und Sprache findest du im Avatar-Menü.",
        },
      ],
    },
    {
      id: "concepts",
      icon: BookOpen,
      title: "Grundkonzepte",
      items: [
        { q: "Konto", a: "Ein realer Geldbehälter: Bankkonto, Bargeld, Kreditkarte, Sparbuch. Jede Buchung gehört zu genau einem Konto (Übertrag zu zweien)." },
        { q: "Buchung", a: "Eine einzelne Geldbewegung: Ausgabe, Einnahme oder Übertrag. Mit Datum, Betrag, Konto, Kategorie und optional Tags, Anhängen, Notizen." },
        { q: "Kategorie", a: "Wofür das Geld war (Lebensmittel, Gehalt, Miete…). Kategorien sind gruppiert; die meisten sind monatliche *Umschläge*, für die du Budgets setzen kannst." },
        { q: "Kategoriegruppe", a: "Bündelt verwandte Kategorien (z. B. *Essen* enthält Lebensmittel, Restaurant, Kaffee). Wird in Auswertungen und für gemeinsame Sweep-Einstellungen verwendet." },
        { q: "Umschlag / Budget", a: "Der monatliche Betrag, den du in einer Kategorie ausgeben willst. Die Budget-Seite zeigt den verbleibenden Stand pro Umschlag." },
        { q: "Scope", a: "Ein Filter, der die App vorbelegt — z. B. eine Reise, ein Projekt, ein gemeinsamer Haushalt. Der aktive Scope beeinflusst Übersicht, Buchungsliste und Add-Formular." },
        { q: "IOU / erstattungsfähig", a: "Eine Buchung, die markiert wurde, weil dir jemand Geld schuldet (oder umgekehrt). Offene IOUs bleiben sichtbar, bis du eine Rückzahlung erfasst, sie als abgegolten markierst, abschreibst oder stornierst." },
        { q: "Offene Buchung", a: "Ein Eintrag, der aus einem externen System (oder über die öffentliche API) importiert wurde und noch nicht gebucht ist. Du prüfst und bestätigst oder lehnst ab." },
        { q: "Wiederkehrende Regel", a: "Eine Vorlage, die Buchungen nach Zeitplan erzeugt (Miete, Gehalt, Abos). Einzelne Vorkommen lassen sich überspringen, ändern oder posten." },
        { q: "Abgleich", a: "Vergleich der App-Salden mit der Realität. Die Abgleich-Seite zeigt jede Abweichung zwischen gebuchten Salden, Sparumschlägen und ungekehrtem Geld." },
        { q: "Sweep / Sparziel", a: "Am Monatsende kann übriges Budget aus einem Umschlag in eine Sparkategorie *gekehrt* werden. Ein Standardziel und Gruppen-Overrides sind möglich." },
        { q: "Anhang", a: "Eine Datei (Quittung, Rechnung), die einer Buchung beiliegt. Optional über Nextcloud synchronisierbar." },
        { q: "Tag", a: "Ein freies Label für Buchungen, das du durchsuchen kannst. Praktisch für Querschnitte, die nicht zu einer Kategorie passen (z. B. *urlaub-2025*)." },
      ],
    },
    {
      id: "screens",
      icon: LayoutDashboard,
      title: "Bildschirme",
      intro: "Ein Abschnitt pro Hauptseite der App.",
      items: [
        { q: "Übersicht (/)", a: "Deine Startseite. Zeigt Kontosalden (Aktiva / Passiva), Monats-Budget, offene IOUs, zu bestätigende Buchungen, anstehende wiederkehrende Posten, Top-Buchungen, Tages-Heatmap und Trends. Jede Karte führt zur passenden Detailseite." },
        { q: "Buchungen (/transactions)", a: "Die vollständige Liste. Filter nach Datum, Konto, Kategorie, Typ, Scope oder Tag. Der Betragsfilter versteht Operatoren wie `>100`, `<=50`, `10-30` oder `=42`. Zeile antippen zum Bearbeiten oder Löschen." },
        { q: "Neu (/add)", a: "Formular für neue Buchungen. Typ (Ausgabe / Einnahme / Übertrag), Betrag, Datum, Konto und Kategorie. Optional: Gegenpartei, Scope, Tags, Anhänge, Notizen und das *erstattungsfähig*-Flag für IOUs. Vorschläge füllen Felder automatisch." },
        { q: "Budgets (/envelopes)", a: "Monatsansicht deiner Umschläge: geplant vs. ausgegeben vs. übrig. Mit *Umverteilen* verschiebst du Budget; Rollover und Sweep-Ziele konfigurierst du in **Einstellungen → Sparen & Sweeps**." },
        { q: "Auswertungen (/insights)", a: "Vier Tabs:\n- **Übersicht** — Summen und Netto für den Zeitraum.\n- **Aufschlüsselung** — Ausgaben nach Kategorie / Gruppe.\n- **Trends** — Monatsvergleich.\n- **Prognose** — Hochrechnung anhand wiederkehrender Regeln und Durchschnitte.\nOben wechselst du Monat / Quartal / Jahr / frei." },
        { q: "Offen (/pending)", a: "Vier Tabs:\n- **Offen** — importierte Einträge, die du bestätigen oder ablehnen sollst.\n- **Offene IOUs** — gebuchte erstattungsfähige Transaktionen, die noch offen sind.\n- **Abgelehnt** — abgelehnte Einträge (zur Nachvollziehbarkeit, wiederherstellbar).\n- **Bestätigt** — bereits bestätigte Einträge; die echte Buchung findest du in Buchungen." },
        { q: "Abgleich (/reconcile)", a: "Zeigt die Differenz (*Drift*) zwischen Kontosumme und Summe aus Sparzuteilungen plus ungekehrtem Geld. Bei Drift = 0 ist alles erfasst. Monatlich nutzen, um vergessene Sweeps oder Überträge zu finden." },
        { q: "Scopes (/scopes)", a: "Anlegen, bearbeiten und wechseln von Scopes (Reisen, Projekte, gemeinsame Haushalte). Der aktive Scope erscheint als Chip im Header und beeinflusst Übersicht, Add-Formular und Kategorie-Vorgaben." },
        { q: "Einstellungen (/settings)", a: "Sämtliche Konfiguration:\n- **Konten** — deine realen Konten.\n- **Kategorien & Budgets** — Wofür und wie viel.\n- **Sparen & Sweeps** — wohin Restbudget am Monatsende fließt.\n- **Wiederkehrende Regeln** — automatisches Posten.\n- **API-Tokens** — für die öffentliche REST-API.\n- **Nextcloud** — Cloud-Speicher für Anhänge.\n- **Audit-Log** — letzte Änderungen.\n- **Export / Import** — Daten ein-/ausspielen (auch fürs Selbsthosten)." },
      ],
    },
    {
      id: "iou-actions",
      icon: Users,
      title: "Ablauf: IOUs (Schulden / Forderungen)",
      intro:
        "Wenn du eine Buchung als erstattungsfähig markierst, erscheint sie als offene IOU. Es gibt vier Wege, eine IOU zu schließen:",
      items: [
        { q: "Rückzahlung hinzufügen", a: "Wenn **tatsächlich Geld geflossen ist**. Öffnet das Add-Formular vorbelegt mit offenem Betrag und Gegenpartei; die neue Buchung wird mit der ursprünglichen verknüpft. Sobald die Verknüpfungssumme den Originalbetrag deckt, schließt die IOU automatisch." },
        { q: "Als abgegolten markieren", a: "Wenn die Schuld **außerhalb der App** geregelt wurde (Bargeld, kleiner Rest). Schließt die IOU ohne neue Buchung. Ein Bestätigungsdialog verhindert Fehlklicks." },
        { q: "Als Verlust buchen (Abschreibung)", a: "Wenn du akzeptierst, dass die Rückzahlung ausbleibt. Erstellt eine Gegenbuchung in einer Kategorie deiner Wahl (z. B. *Forderungsausfall*, *Geschenke*), damit der Verlust in Budget und Auswertungen sichtbar wird." },
        { q: "Stornieren", a: "Wenn die IOU **gar nicht hätte entstehen sollen** (falsch markiert, Duplikat). Entfernt das IOU-Flag komplett. Keine Gegenbuchung." },
      ],
    },
    {
      id: "workflows",
      icon: Sparkles,
      title: "Typische Abläufe",
      items: [
        { q: "Gemeinsame Ausgabe und Rückzahlung", a: "1. Buchung erfassen, **Erstattungsfähig** aktivieren, Gegenpartei wählen.\n2. Sie erscheint unter **Offene IOUs** auf der Übersicht.\n3. Wenn das Geld kommt: **Rückzahlung hinzufügen** — Formular ist vorbelegt, nur speichern.\n4. Die IOU schließt automatisch, sobald sie voll gedeckt ist. Für Teilbeträge oder Bargeld nutze stattdessen *Als abgegolten markieren* oder *Als Verlust buchen*." },
        { q: "Buchungen per API importieren", a: "1. In **Einstellungen → API-Tokens** ein Token erstellen.\n2. Einträge an `/api/public/pending-transactions` POSTen (Swagger UI unter `/api/public/docs`).\n3. Importe erscheinen in **Offen → Offen**. Prüfen und bestätigen oder ablehnen." },
        { q: "Monatsabschluss", a: "1. **Abgleich** öffnen, Drift bereinigen.\n2. Restbudgets in Sparkategorien sweepen.\n3. **Auswertungen → Übersicht** und **Trends** prüfen.\n4. Budgets für den nächsten Monat anpassen." },
        { q: "Wiederkehrende Rechnungen", a: "1. In **Einstellungen → Wiederkehrende Regeln** eine Regel anlegen (Takt, Betrag, Kategorie).\n2. *Anstehend*-Karte zeigt offene Vorkommen.\n3. Jedes Vorkommen einzeln posten, ändern oder überspringen." },
        { q: "Nextcloud verbinden", a: "**Einstellungen → Nextcloud** öffnen und dem OAuth-Flow folgen. Danach werden Anhänge in deiner Nextcloud gespeichert und über einen Dateibrowser eingebunden." },
      ],
    },
    {
      id: "faq",
      icon: HelpCircle,
      title: "FAQ & Fehlersuche",
      items: [
        { q: "Eine als abgegolten markierte IOU war nach dem Reload wieder da", a: "War ein bekannter Bug und ist behoben: die UI meldet jetzt nur Erfolg, wenn das Update in der Datenbank tatsächlich gelaufen ist. Falls es erneut auftritt, notiere die Buchungs-ID und prüfe, ob die Zeile für deinen User erreichbar ist (RLS / Scope)." },
        { q: "Warum ist meine Drift nicht null?", a: "Drift heißt: Summe der Kontostände passt nicht zu Sparständen + ungekehrtem Geld. Typische Ursachen: Übertrag nur einseitig erfasst, Buchung in einer Sparkategorie ohne Sweep, oder Kategorie fälschlich als Sparkategorie markiert. Letzte Bewegungen der betroffenen Konten durchgehen." },
        { q: "Wo landen übersprungene wiederkehrende Vorkommen?", a: "Nirgends — sie werden einfach nicht gepostet. Die Regel läuft mit dem nächsten Termin weiter. Du kannst ein Vorkommen jederzeit später aus der *Anstehend*-Karte posten." },
      ],
    },
    {
      id: "data-storage",
      icon: Shield,
      title: "Datenspeicherung & Datenschutz",
      intro:
        "Bitte mach dir bewusst, wo und wie deine Daten gespeichert werden, bevor du Sensibles eingibst.",
      items: [
        { q: "Wo werden meine Daten gespeichert?", a: "Diese Instanz läuft auf einem **privaten Homelab-Server in der Schweiz**, betrieben von einer Einzelperson (nicht einem Unternehmen oder Cloud-Anbieter). Sie steht nicht in einem kommerziellen Rechenzentrum." },
        { q: "Sind meine Daten verschlüsselt?", a: "**Nein.** Die Daten liegen aktuell **unverschlüsselt** in der Datenbank. Die betreibende Person hat vollen technischen Zugriff und kann alle eingegebenen Informationen lesen (Beschreibungen, Beträge, Notizen, Anhänge, Tags, Kontonamen usw.)." },
        { q: "Was bedeutet das für mich?", a: "Gib nur Informationen ein, mit deren Einsicht durch die betreibende Person du einverstanden bist. Vermeide stark sensible Daten (Passwörter, vollständige IBANs, medizinische Hinweise usw.)." },
        { q: "Wie ist das rechtlich geregelt?", a: "Siehe die [Datenschutzerklärung / DSGVO-Hinweis](/privacy) — du hast ihr bei der Registrierung zugestimmt. Sie nennt die verantwortliche Stelle, was gespeichert wird, und deine Rechte nach DSGVO." },
        { q: "Kann ich meine eigene Instanz betreiben?", a: "Ja. Das Projekt ist Open Source. Siehe das [GitHub-Repository](https://github.com/Jonas-Marty/cash-flow-jm) — die README erklärt Build und Deployment gegen eine eigene Supabase-Instanz." },
      ],
    },
  ],
};

const CONTENT: Record<Lang, Content> = { en: EN, de: DE };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function HelpPage() {
  const { lang } = useI18n();
  const c = CONTENT[lang] ?? CONTENT.en;
  const [query, setQuery] = React.useState("");

  // Deep-link: open accordion item matching hash on mount.
  const [openItems, setOpenItems] = React.useState<Record<string, string | undefined>>({});
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const q = query.trim().toLowerCase();
  const filteredSections = React.useMemo(() => {
    if (!q) return c.sections;
    return c.sections
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (it) => it.q.toLowerCase().includes(q) || it.a.toLowerCase().includes(q),
        ),
      }))
      .filter((s) => s.items.length > 0);
  }, [c.sections, q]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BookOpen className="h-6 w-6 text-primary" />
          {c.pageTitle}
        </h1>
        <p className="text-sm text-muted-foreground">{c.pageSubtitle}</p>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={c.searchPlaceholder}
          className="pl-9"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        {/* ToC */}
        <nav className="hidden lg:block">
          <div className="sticky top-20 space-y-1 text-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {c.toc}
            </div>
            {c.sections.map((s) => {
              const Icon = s.icon;
              return (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate">{s.title}</span>
                </a>
              );
            })}
          </div>
        </nav>

        {/* Sections */}
        <div className="space-y-6">
          {filteredSections.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {c.noResults}
              </CardContent>
            </Card>
          )}
          {filteredSections.map((s) => {
            const Icon = s.icon;
            return (
              <section key={s.id} id={s.id} className="scroll-mt-20">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Icon className="h-5 w-5 text-primary" />
                      {s.title}
                      {q && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          {s.items.length}
                        </Badge>
                      )}
                    </CardTitle>
                    {s.intro && (
                      <p className="text-sm text-muted-foreground">{s.intro}</p>
                    )}
                  </CardHeader>
                  <CardContent>
                    <Accordion
                      type="single"
                      collapsible
                      value={openItems[s.id]}
                      onValueChange={(v) =>
                        setOpenItems((prev) => ({ ...prev, [s.id]: v || undefined }))
                      }
                      className="w-full"
                    >
                      {s.items.map((it, idx) => (
                        <AccordionItem key={idx} value={`${s.id}-${idx}`}>
                          <AccordionTrigger className="text-left text-sm">
                            {it.q}
                          </AccordionTrigger>
                          <AccordionContent>
                            <Markdown>{it.a}</Markdown>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </CardContent>
                </Card>
              </section>
            );
          })}

          <Separator />
          <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
            <a
              href="https://github.com/Jonas-Marty/cash-flow-jm"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <Github className="h-3.5 w-3.5" />
              {lang === "de" ? "Quellcode auf GitHub" : "Source code on GitHub"}
            </a>
            <Link to="/privacy" className="hover:text-foreground">
              {lang === "de" ? "Datenschutz / DSGVO" : "Privacy / GDPR"}
            </Link>
            <Link to="/" className="underline-offset-2 hover:underline">
              ← {lang === "de" ? "Zur Übersicht" : "Back to dashboard"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
