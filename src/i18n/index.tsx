import * as React from "react";
import { de as deLocale, enUS as enLocale } from "date-fns/locale";
import type { Locale } from "date-fns";

export type Lang = "de" | "en";

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
];

type Dict = Record<string, string>;

const de: Dict = {
  // Nav
  "nav.dashboard": "Übersicht",
  "nav.transactions": "Buchungen",
  "nav.add": "Neu",
  "nav.envelopes": "Budgets",
  "nav.settings": "Einstellungen",
  "nav.add_transaction": "Buchung hinzufügen",
  "app.name": "Cashflow",

  // Common
  "common.all": "Alle",
  "common.none": "— Keine —",
  "common.cancel": "Abbrechen",
  "common.save": "Speichern",
  "common.saving": "Speichere…",
  "common.delete": "Löschen",
  "common.add": "Hinzufügen",
  "common.archive": "Archivieren",
  "common.unarchive": "Wiederherstellen",
  "common.from": "Von",
  "common.to": "Bis",
  "common.optional": "(optional)",
  "common.name": "Name",
  "common.type": "Typ",
  "common.kind": "Art",
  "common.group": "Gruppe",
  "common.no_data": "Noch keine Daten.",
  "common.viewAll": "Alle ansehen",

  // Toasts
  "toast.saved": "Gespeichert",
  "toast.deleted": "Gelöscht",
  "toast.name_required": "Name erforderlich",
  "toast.amount_required": "Betrag eingeben",
  "toast.account_required": "Konto auswählen",
  "toast.dest_required": "Zielkonto auswählen",
  "toast.dest_must_differ": "Quelle und Ziel müssen unterschiedlich sein",
  "toast.currency_updated": "Währung aktualisiert",
  "toast.language_updated": "Sprache aktualisiert",
  "toast.account_added": "Konto hinzugefügt",
  "toast.envelope_added": "Budget hinzugefügt",
  "toast.group_added": "Gruppe hinzugefügt",

  // Confirms
  "confirm.delete_account": "Konto löschen? Buchungen müssen zuerst entfernt werden.",
  "confirm.delete_envelope": "Budget löschen?",
  "confirm.delete_group": "Gruppe löschen? Budgets werden ungruppiert.",
  "confirm.delete_transaction": "Buchung löschen?",

  // Dashboard
  "dashboard.title": "Übersicht",
  "dashboard.networth": "Nettovermögen",
  "dashboard.assets": "Vermögen",
  "dashboard.liabilities": "Verbindlichkeiten",
  "dashboard.envelopes_month": "Budgets — diesen Monat",
  "dashboard.recent": "Letzte Buchungen",
  "dashboard.no_envelopes": "Noch keine Budgets.",
  "dashboard.create_in_settings": "In den Einstellungen anlegen",
  "dashboard.no_transactions": "Noch keine Buchungen.",
  "dashboard.assets_empty": "Lege dein erstes Vermögenskonto in den Einstellungen an.",
  "dashboard.liab_empty": "Kreditkarten in den Einstellungen hinzufügen.",
  "dashboard.over_by": "Überzogen um {x}",
  "dashboard.remaining": "{x} verbleibend",
  "dashboard.this_month_savings": "Diesen Monat: +{a} zugeteilt · −{b} ausgegeben",
  "dashboard.balance": "Saldo",

  // Add transaction
  "add.title": "Buchung hinzufügen",
  "add.expense": "Ausgabe",
  "add.income": "Einnahme",
  "add.transfer": "Umbuchung",
  "add.account": "Konto",
  "add.from_account": "Von Konto",
  "add.to_account": "Auf Konto",
  "add.no_accounts": "Keine Konten — in den Einstellungen anlegen",
  "add.create_first_account": "Erstes Konto anlegen →",
  "add.category": "Kategorie",
  "add.category_optional_reimb": "(optional — für Rückerstattung zuweisen)",
  "add.select_category": "Kategorie auswählen",
  "add.payee": "Empfänger",
  "add.payee_placeholder": "Wer / wo",
  "add.note": "Notiz · #tags zur späteren Filterung",
  "add.note_placeholder": "z.B. Abendessen mit Freunden #twint #paris",
  "add.date": "Datum",
  "add.save_new": "Speichern & Neu",
  "add.savings_badge": "Rückstellung",
  "add.income_badge": "Einnahme",

  // Transactions
  "tx.title": "Buchungen",
  "tx.search_placeholder": "Empfänger oder Notiz suchen…",
  "tx.all_types": "Alle Typen",
  "tx.all_accounts": "Alle Konten",
  "tx.all_categories": "Alle Kategorien",
  "tx.all_tags": "Alle Tags",
  "tx.no_match": "Keine Buchungen entsprechen den Filtern.",
  "tx.add_one": "Eine hinzufügen",
  "tx.reimbursement": "Rückerstattung",
  "tx.transfer_label": "Umbuchung",

  // Envelopes
  "env.title": "Budgets",
  "env.no_envelopes": "Noch keine Budgets.",
  "env.balance": "Saldo {x}",
  "env.income_label": "Einnahme",
  "env.income_adjustment": "Anpassung",
  "env.savings_refund": "Erstattung",
  "env.savings_booking": "Buchung",
  "env.expense_label": "Ausgabe",
  "env.reimb_short": "Rückerstattung",

  // Settings
  "settings.title": "Einstellungen",
  "settings.language": "Sprache",
  "settings.currency": "Währung",
  "settings.accounts": "Konten",
  "settings.groups": "Gruppen",
  "settings.envelopes": "Budgets (Kategorien)",
  "settings.opening_balance": "Anfangssaldo",
  "settings.monthly_budget": "Monatsbudget",
  "settings.account_asset": "Vermögen",
  "settings.account_liability": "Verbindlichkeit",
  "settings.kind_income": "Einnahme",
  "settings.kind_expense": "Ausgabe",
  "settings.kind_savings": "Rückstellung",
  "settings.no_accounts": "Noch keine Konten.",
  "settings.no_envelopes": "Noch keine Budgets.",
  "settings.no_groups": "Noch keine Gruppen. Lege z.B. „Fixkosten“, „Persönliche Ausgaben“, „Einnahmen“, „Rückstellungen“ an.",
  "settings.footer": "Einzelnutzer-Modus · Monatliche Budgets setzen sich jeden Kalendermonat zurück, kein Übertrag · Login folgt später.",
};

const en: Dict = {
  "nav.dashboard": "Dashboard",
  "nav.transactions": "Transactions",
  "nav.add": "Add",
  "nav.envelopes": "Envelopes",
  "nav.settings": "Settings",
  "nav.add_transaction": "Add transaction",
  "app.name": "Cashflow",

  "common.all": "All",
  "common.none": "— None —",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.delete": "Delete",
  "common.add": "Add",
  "common.archive": "Archive",
  "common.unarchive": "Unarchive",
  "common.from": "From",
  "common.to": "To",
  "common.optional": "(optional)",
  "common.name": "Name",
  "common.type": "Type",
  "common.kind": "Kind",
  "common.group": "Group",
  "common.no_data": "No data yet.",
  "common.viewAll": "View all",

  "toast.saved": "Saved",
  "toast.deleted": "Deleted",
  "toast.name_required": "Name required",
  "toast.amount_required": "Enter an amount",
  "toast.account_required": "Pick an account",
  "toast.dest_required": "Pick a destination account",
  "toast.dest_must_differ": "Source and destination must differ",
  "toast.currency_updated": "Currency updated",
  "toast.language_updated": "Language updated",
  "toast.account_added": "Account added",
  "toast.envelope_added": "Envelope added",
  "toast.group_added": "Group added",

  "confirm.delete_account": "Delete this account? Its transactions must be removed first.",
  "confirm.delete_envelope": "Delete this envelope?",
  "confirm.delete_group": "Delete this group? Envelopes will become ungrouped.",
  "confirm.delete_transaction": "Delete this transaction?",

  "dashboard.title": "Dashboard",
  "dashboard.networth": "Net worth",
  "dashboard.assets": "Assets",
  "dashboard.liabilities": "Liabilities",
  "dashboard.envelopes_month": "Envelopes — this month",
  "dashboard.recent": "Recent transactions",
  "dashboard.no_envelopes": "No envelopes yet.",
  "dashboard.create_in_settings": "Create one in Settings",
  "dashboard.no_transactions": "No transactions yet.",
  "dashboard.assets_empty": "Create your first asset account in Settings.",
  "dashboard.liab_empty": "Add credit cards in Settings.",
  "dashboard.over_by": "Over by {x}",
  "dashboard.remaining": "{x} remaining",
  "dashboard.this_month_savings": "This month: +{a} alloc · −{b} spent",
  "dashboard.balance": "Balance",

  "add.title": "Add transaction",
  "add.expense": "Expense",
  "add.income": "Income",
  "add.transfer": "Transfer",
  "add.account": "Account",
  "add.from_account": "From account",
  "add.to_account": "To account",
  "add.no_accounts": "No accounts — add one in Settings",
  "add.create_first_account": "Create your first account →",
  "add.category": "Category",
  "add.category_optional_reimb": "(optional — assign for reimbursement)",
  "add.select_category": "Select category",
  "add.payee": "Payee",
  "add.payee_placeholder": "Where / who",
  "add.note": "Note · use #tags to filter later",
  "add.note_placeholder": "e.g. dinner with friends #twint #paris",
  "add.date": "Date",
  "add.save_new": "Save & New",
  "add.savings_badge": "Reserve",
  "add.income_badge": "Income",

  "tx.title": "Transactions",
  "tx.search_placeholder": "Search payee or note…",
  "tx.all_types": "All types",
  "tx.all_accounts": "All accounts",
  "tx.all_categories": "All categories",
  "tx.all_tags": "All tags",
  "tx.no_match": "No transactions match these filters.",
  "tx.add_one": "Add one",
  "tx.reimbursement": "Reimbursement",
  "tx.transfer_label": "Transfer",

  "env.title": "Envelopes",
  "env.no_envelopes": "No envelopes yet.",
  "env.balance": "Balance {x}",
  "env.income_label": "Income",
  "env.income_adjustment": "Adjustment",
  "env.savings_refund": "Refund",
  "env.savings_booking": "Booking",
  "env.expense_label": "Expense",
  "env.reimb_short": "Reimb.",

  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.currency": "Currency",
  "settings.accounts": "Accounts",
  "settings.groups": "Groups",
  "settings.envelopes": "Envelopes (Categories)",
  "settings.opening_balance": "Opening balance",
  "settings.monthly_budget": "Monthly budget",
  "settings.account_asset": "Asset",
  "settings.account_liability": "Liability",
  "settings.kind_income": "Income",
  "settings.kind_expense": "Expense",
  "settings.kind_savings": "Savings (Reserve)",
  "settings.no_accounts": "No accounts yet.",
  "settings.no_envelopes": "No envelopes yet.",
  "settings.no_groups": "No groups yet. Create groups like \"Fixed costs\", \"Personal\", \"Income\", \"Reserves\".",
  "settings.footer": "Single-user mode · monthly envelopes reset each calendar month with no rollover · authentication will plug in later.",
};

const dicts: Record<Lang, Dict> = { de, en };

const localeMap: Record<Lang, Locale> = { de: deLocale, en: enLocale };

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  locale: Locale;
};

const I18nContext = React.createContext<Ctx | null>(null);

export function I18nProvider({ lang, setLang, children }: { lang: Lang; setLang: (l: Lang) => void; children: React.ReactNode }) {
  const t = React.useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = dicts[lang] ?? dicts.de;
      let s = dict[key] ?? dicts.de[key] ?? key;
      if (vars) for (const k of Object.keys(vars)) s = s.replaceAll(`{${k}}`, String(vars[k]));
      return s;
    },
    [lang],
  );
  const value = React.useMemo<Ctx>(
    () => ({ lang, setLang, t, locale: localeMap[lang] ?? deLocale }),
    [lang, setLang, t],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
