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
  Sparkles, Search, Shield, Github, Webhook, Link2, FileText,
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
      intro:
        "These building blocks work together to give you a complete picture of your money. Think of it like a set of envelopes, a notebook, and a filing cabinet — just digital.",
      items: [
        {
          q: "Account",
          a: "A real-world container for money: a bank account, cash wallet, credit card, or savings pot. Every transaction belongs to exactly one account (transfers belong to two).\n\n**Example:** You might have *UBS Checking*, *PostFinance Savings*, *Cash in Wallet*, and *Visa Credit Card*. When you buy groceries with your Visa, the transaction is recorded against the *Visa Credit Card* account. When you withdraw cash from an ATM, that is a transfer from *UBS Checking* to *Cash in Wallet*.\n\n**Opening balance sign:** The same sign convention applies to every account, whether asset or liability:\n- **Positive** = money you own (e.g. cash in a bank account, prepaid card balance).\n- **Negative** = money you owe (e.g. debt on a credit card, outstanding loan).\n\n**Example — new credit card:** You open a Visa account in the app but have already spent CHF 500 with it before tracking. Enter the opening balance as **-500**. The balance shows *-CHF 500.00* (\"I owe 500\"). New expenses make it more negative; a payment from your bank makes it less negative. If you entered *+500* instead, the app would treat the card like a prepaid wallet with money in it, and your net worth would be off by CHF 1,000. The same rule applies to mortgages, personal loans, and any other liability — start negative if you currently owe money.",
        },
        {
          q: "Transaction",
          a: "A single movement of money: an expense, income, or transfer. Has a date, amount, account, category and optional tags, attachments and notes.\n\n**Example:** On 5 June you spend CHF 64.50 at Migros using your debit card. That is an **expense** of 64.50, on account *UBS Checking*, in category *Groceries*. On 30 June your employer pays your salary of CHF 5,200 — that is an **income** transaction on account *UBS Checking*, category *Salary*. Moving CHF 200 from checking to savings is a **transfer**.",
        },
        {
          q: "Category",
          a: "What the money was for (Groceries, Salary, Rent…). Categories are grouped, and most categories represent a monthly *envelope* you can budget.\n\n**Example:** You create categories like *Groceries*, *Restaurant*, *Coffee*, *Rent*, *Electricity*, *Salary*, and *Holiday Savings*. When you record a purchase, you pick the category so the app knows which envelope to draw from. A reimbursement from a friend goes into a category too — but you might leave the category empty so it does not affect your budget.",
        },
        {
          q: "Category group",
          a: "A bucket that groups related categories (e.g. *Food* contains Groceries, Eating out, Coffee). Used in reports and for shared sweep settings.\n\n**Example:** Your *Food* group holds *Groceries*, *Restaurant*, and *Coffee*. Your *Fixed Costs* group holds *Rent*, *Insurance*, and *Phone*. When you look at the Insights Breakdown tab, you can see totals per group — which quickly tells you whether you spend more on food or fixed costs.",
        },
        {
          q: "Envelope / budget",
          a: "The monthly amount you plan to spend in a category. The Envelopes screen shows how much is left in each envelope for the current month.\n\n**Example:** You decide to budget CHF 400 for *Groceries* this month. The envelope starts with 400. After you spend 120 at Migros, the envelope shows 280 left. If you later spend 50 at the bakery, it drops to 230. If you receive a CHF 30 reimbursement for a shared dinner (linked to an IOU), the envelope grows back to 260 — because you got some of that grocery money back.\n\nAt month-end, whatever is still in the envelope (or the shortfall) is handled by your sweep and rollover settings.",
        },
        {
          q: "Scope",
          a: "A lens that pre-filters and pre-fills the app — for example a trip, a project, or a shared household. Switching the active scope changes the dashboard, transaction list and add-form defaults.\n\n**What it is really for:** A scope is meant for **one-off events** (a vacation, a music festival, a wedding) where you want to collect all related expenses in one place and then **close** it with a single visible money reallocation. When you close a scope, the total spent is virtually moved from a funding category into the scope's own category — so you see the whole cost in one transparent \"payment.\"\n\n**What it is NOT for:** Regular monthly expenses. Do not create a scope for *Groceries* or *Restaurant* — those belong in normal budget categories with monthly envelopes.\n\n**Example:** You create a scope called *Glastonbury 2025* with a planned budget of CHF 1,200, funded from your *Fun* category. During the festival you record tickets, camping gear, food and drinks — all tagged with the scope. When you get home, you close the scope: the app moves CHF 1,180 (what you actually spent) from *Fun* into *Glastonbury 2025*. Now you see the entire festival cost as one line, and your *Fun* envelope was reduced accordingly. Then you switch back to the default scope and your normal household budget returns.",
        },
        {
          q: "IOU / reimbursable",
          a: "A transaction flagged because someone owes you (or you owe someone). Open IOUs stay visible until you record a repayment, mark them settled, write them off, or cancel them.\n\n**Example:** You pay CHF 120 for a team dinner with your credit card and your colleague owes you half. You record the expense as CHF 120, toggle **Reimbursable**, enter *Colleague Anna* as counterparty. The full 120 hits your *Restaurant* budget, but an open IOU of 60 shows up on your dashboard. When Anna pays you back via TWINT, you record a repayment — the IOU closes and your *Restaurant* envelope gets credited back 60.",
        },
        {
          q: "Pending transaction",
          a: "An entry imported from outside the app (via the public API or another source) that has not yet been booked. You review it and then confirm or reject.\n\n**Example:** Your bank API pushes a transaction: *Coop, CHF 45.30, 12 June*. It lands in **Pending** because the app does not know which category it belongs to. You open it, assign *Groceries*, and click **Confirm**. Now it becomes a real transaction in your ledger.",
        },
        {
          q: "Recurring rule",
          a: "A template that posts a transaction on a schedule (rent, salary, subscriptions). You can skip, edit or post individual occurrences.\n\n**Example:** Your rent of CHF 1,450 is due on the 1st of every month. You set up a recurring rule: amount 1,450, category *Rent*, account *UBS Checking*, day-of-month = 1. The dashboard shows the next upcoming occurrence. If you are on holiday and the landlord delays the debit until the 5th, you can edit that single occurrence without changing the rule.\n\n**How the schedule is built (v2 engine):**\n- **Interval** is a whole number of months (1 = monthly, 3 = quarterly, 12 = yearly). No weekly cadence.\n- **Execution** and **Reporting period** are configured *independently*, each with its own day-rule (`FixedDay N`, `LastDay`, `FirstDay`). Example: execute on the last business day, report as if for the 1st–31st.\n- **Weekend adjustment** (`None` / `PreviousBusinessDay` / `NextBusinessDay`) only shifts the *execution* date; the reporting period stays anchored to the original due date.\n- **Period offset** (−3…+3) lets you post now for a past or future period (e.g. VAT filed in April for Q1: offset −1).\n- Description and note support the tokens `${date}`, `${dueDate}`, `${periodFrom}`, `${periodTo}`, `${runNumber}`, with date formatters like `dd.MM.yyyy`, `MMMM`, `Q` (quarter), `S` (semester), `T` (trimester), `ww` (ISO week). Older tokens (`${periodLabel}`, `${today}`, `${year}`, …) are no longer supported — the editor warns when a saved template still references them.",
        },
        {
          q: "Reconciliation",
          a: "Comparing the app's account totals with reality. The Reconcile screen shows any drift between booked balances, savings envelopes, and unswept money.\n\n**Example:** Your real bank statement says your checking account holds CHF 3,240. The app says CHF 3,440. The reconcile screen shows a CHF 200 drift. You trace it back: you recorded a transfer to savings but forgot to create the matching incoming side. After fixing it, drift is zero and everything lines up.",
        },
        {
          q: "Sweep / savings target",
          a: "At month-end, any leftover budget in an envelope can be *swept* into a savings category. You can set a default target and per-group overrides.\n\n**What happens with leftover money?**\nImagine your *Groceries* envelope had CHF 400 for June. You only spent CHF 350. At the end of June, the remaining CHF 50 can be **swept** into your *Holiday Savings* category (or any savings target you configured). That CHF 50 is now counted as saved, and the *Groceries* envelope resets to zero for the fresh month of July.\n\n**What happens if you overspend?**\nImagine you budgeted CHF 400 for *Groceries* but spent CHF 450. At month-end the envelope shows −50. Depending on your settings, that shortfall can be left as-is (you start July already 50 in the red), or it can be covered from another envelope via *Reallocate*. The app never silently moves money — you always decide what happens.\n\nSavings categories (like *Holiday Savings* or *Emergency Fund*) are different: they are **running balances**, not monthly envelopes. Money accumulates month after month until you spend from them.",
        },
        {
          q: "Attachment",
          a: "A file (receipt, invoice) linked to a transaction. Optionally synced to Nextcloud if you connect it.\n\n**Example:** After paying CHF 89 for a dentist visit, you snap a photo of the receipt and attach it to the transaction. Six months later, when your health insurance asks for proof, you open the transaction and the receipt is right there.",
        },
        {
          q: "Tag",
          a: "A free-form label you can attach to transactions and search by. Useful for cross-cutting concerns that don't fit categories (e.g. *vacation-2025*).\n\n**Example:** You tag flights, hotel bookings, and restaurant meals with *#paris-2025*. Later, you can search that tag and see the total cost of the trip across all categories — without creating a separate *Paris* category for each expense type.",
        },
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
        {
          q: "Do reallocations affect a category's monthly budget?",
          a: "**No.** A reallocation only moves money between **savings** category balances (their running totals). The monthly envelope view (`Envelopes` / budget summary) is computed purely from real `transactions` rows — it ignores `category_reallocations` entirely.\n\n**What this means in practice:**\n- Moving CHF 100 from *Holiday Savings* → *Emergency Fund* changes both savings balances. No monthly envelope is touched.\n- Closing a scope inserts a reallocation from the **funding** category → the **scope's own** category. For that reallocation to actually move a balance, the funding category must be a **savings** category (running balance). If the funding category is a regular monthly envelope, the reallocation row is still written, but the funding envelope's *spent this month* total will not change — the original transactions you booked during the scope still hit whichever categories you picked at booking time.\n- **Rule of thumb:** treat scopes as a *savings → savings* movement. Fund them from a savings envelope (e.g. *Fun Money Pot*, *Travel Pot*), and the scope's own category will receive the final reallocated total.",
        },
        {
          q: "Could reallocations be made to affect monthly budgets too?",
          a: "Technically yes, but it would change the meaning of an envelope. Today an envelope answers *\"how much did I actually spend in this category this month?\"* — purely from transactions, which keeps it auditable against a bank statement.\n\nIf reallocations were folded in, an envelope would instead answer *\"how much budget did this category end up with after manual adjustments?\"* That introduces three side-effects to weigh:\n- **Double counting risk.** A scope close already redistributes via a reallocation; if envelopes also reacted to it, the same CHF would appear twice in reports unless every aggregation explicitly subtracts the reallocation leg.\n- **Historical drift.** Editing a reallocation would silently rewrite past months' budget figures.\n- **Insights & projection.** Trends, projections and the budget-balance card would all need to choose between *cash-flow truth* (transactions only) and *planned-vs-adjusted truth* (transactions + reallocations).\n\nFor now Cashflow deliberately keeps the two layers separate: **transactions** drive monthly envelopes, **reallocations** drive savings balances and scope closing.",
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
          a: "Prefill the Add-Transaction form from a sentence like *\"I spent 50 at Coop on groceries, paid by credit card\"*; answer questions about your data (*\"where did I spend most last month?\"*) by calling read-only tools; read bank and credit-card statements you upload on the **Statements** screen (PDF or a photo/screenshot) and turn them into comparable rows; and explain app features and the privacy notice. It will refuse any other topic.",
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
    {
      id: "statements",
      icon: FileText,
      title: "Statement import",
      intro:
        "Upload a bank or credit-card statement on the Statements screen and let the AI read it, then compare every row against your ledger to find missing, duplicate or wrongly booked transactions.",
      items: [
        {
          q: "Which file types can I upload?",
          a: "- **PDF** — the digital statement from your bank. The text layer is extracted locally and only the text is sent to your AI endpoint.\n- **Images** — PNG, JPEG, WebP or GIF, e.g. a **photo or screenshot** of a paper statement or a banking app. The image is sent to your AI endpoint as an image, so the connection you use for *Statement extraction* must support vision.\n\nA scanned PDF without a text layer cannot be read — take a photo/screenshot of it instead and upload that as an image.",
        },
        {
          q: "How do I import one?",
          a: "1. Open **Statements**, pick the **account** the statement belongs to.\n2. Choose the file (PDF or image).\n3. Set the **date tolerance** (default 3 days) — booking dates in the app and at the bank rarely match exactly.\n4. Enable **invert amounts** if the statement shows expenses as positive numbers (common on credit-card statements).\n5. Start the import. The AI extracts the rows, then a deterministic matcher compares them with your transactions.",
        },
        {
          q: "How does matching work?",
          a: "Matching is done in code, not by the AI:\n- **Amount must agree to the cent.** Split transactions are summed per split group first.\n- **Date** must be inside your tolerance window.\n- **Description similarity** only ranks candidates and decides *exact* vs *probable* — it never creates a match on its own.\n- Each app transaction can be consumed by **at most one** statement line, so repeated identical amounts are never double-matched.",
        },
        {
          q: "What do the result groups mean?",
          a: "- **Missing** — on the statement, but not in the app. Create the transaction with one click (the Add form is prefilled).\n- **Probable** — a likely match; confirm or reset it.\n- **Matched** — exact matches, nothing to do.\n- **Ignored** — rows you marked irrelevant (fees you don't track, carry-forwards).\n- **Not on the statement** — transactions in the app inside the statement period that the statement does not contain: typically a duplicate, a wrong date, or a booking on the wrong account.",
        },
        {
          q: "What is sent to my AI provider?",
          a: "The statement text (PDF) or the image itself, plus the account currency and today's date — nothing else from your ledger. Matching happens afterwards on the server without any AI call. Choose the connection under **Settings → AI Assistant → Statement extraction**; the usual fallback to the next enabled connection applies.",
        },
      ],
    },
    {
      id: "webhooks",
      icon: Webhook,
      title: "Webhooks",
      intro:
        "Outbound webhooks notify an external service (e.g. n8n, Zapier, your own script) whenever a transaction is created. Useful for forwarding shared-household expenses to a separate app like Flatastic.",
      items: [
        {
          q: "What triggers a webhook?",
          a: "A webhook is fired for every newly created transaction, from any of these sources:\n- **`transaction.created.manual`** — you saved it via the Add screen.\n- **`transaction.created.recurring`** — a recurring rule auto-posted it.\n- **`transaction.created.api`** — it came in through the public REST API.\n\nEdits, deletes and reallocations do **not** fire a webhook (by design — keeps the contract simple).",
        },
        {
          q: "How do I add one?",
          a: "**Settings → Webhooks**: enter a name (free text, just for you), the target **URL** (must be reachable from the server), and optionally an **auth header**. The header name + value are sent on every request — n8n's *Header Auth* node, Zapier's *Custom Webhook*, or your own server can verify it.\n\nClick **Send test** to push a synthetic payload immediately and check your receiver.",
        },
        {
          q: "Delivery, retries and logging",
          a: "Delivery is **fire-and-forget from the user's perspective** — your transaction is saved first, then the webhook is dispatched in the background. Each delivery attempts up to **3 times** (1s and 4s back-off, 10s timeout per attempt). Every attempt is logged to:\n- **stdout** (structured JSON), useful when self-hosting,\n- the **audit log** (`Settings → Audit log`, action `custom`, kind `webhook.delivery`), with status, attempts, duration and error message.\n\nThere is no persistent queue: if all 3 attempts fail, the delivery is dropped and only the failure shows up in the audit log. Future notification channels (e.g. Gotify) will plug into the same dispatcher.",
        },
        {
          q: "Payload structure",
          a: "`POST <your-url>` with `Content-Type: application/json` and your configured auth header. Body:\n\n```json\n{\n  \"event\": \"transaction.created.manual\",\n  \"delivered_at\": \"2026-06-18T10:30:00.000Z\",\n  \"delivery_id\": \"a1c8e9d2-2f4d-4c11-9b1e-7e2a3a3d40e5\",\n  \"transaction\": {\n    \"id\": \"6b6a7c80-1f4a-4c2c-8f7d-2c0b3f1d9d11\",\n    \"occurred_on\": \"2026-06-18\",\n    \"amount\": 42.50,\n    \"destination_amount\": null,\n    \"type\": \"expense\",\n    \"source_account_id\": \"b6e3d0fa-…\",\n    \"destination_account_id\": null,\n    \"category_id\": \"3a9b1f7c-…\",\n    \"description\": \"Migros\",\n    \"note\": null,\n    \"tags\": [\"groceries\", \"household\"],\n    \"split_group_id\": null,\n    \"recurring_rule_id\": null,\n    \"created_at\": \"2026-06-18T10:30:00.142Z\"\n  }\n}\n```\n\nNotes:\n- `amount` is always **positive**; use `type` to interpret the sign (`expense` / `income` / `transfer`).\n- `destination_amount` is only set for cross-currency transfers.\n- `tags` are sent as a flat string array so receivers can branch without a second API call (e.g. *forward to Flatastic only if `tags` contains `household`*).\n- `delivery_id` is unique per delivery attempt batch — safe to use for **idempotency** on the receiver side.\n- IDs reference rows in your Cashflow database; resolve them via the public REST API if you need human-readable account or category names.",
        },
        {
          q: "Example: forwarding to Flatastic via n8n",
          a: "1. In n8n, create a workflow with a **Webhook** trigger node (method `POST`, *Header Auth* with the same name/value you store in Cashflow).\n2. Add an **IF** node to filter: e.g. only continue when `{{$json.transaction.tags}}` contains `household`.\n3. Add an **HTTP Request** node that calls the Flatastic API with the mapped fields.\n4. Activate the workflow, then in Cashflow click **Send test** — you should see the test event arrive in n8n.",
        },
        {
          q: "Security",
          a: "- Use **HTTPS** URLs (HTTP is rejected outside localhost).\n- The auth header value is stored server-side and **never logged** (not in stdout, not in the audit log).\n- Each webhook is scoped to your user (RLS): nobody else can read, edit, or fire it.\n- The server operator can read the stored header value in the database — treat it like any other credential on this instance.",
        },
      ],
    },
    {
      id: "links",
      icon: Link2,
      title: "Transaction links",
      intro:
        "Group several individually-booked transactions that belong to the same real-world purchase (gift cards split across two cards, concert ticket + on-site food, IKEA trip paid by cash + card). The transactions still count individually in budgets, categories and KPIs — the link is just a named view on top.",
      items: [
        {
          q: "How does it differ from splits, tags and reimbursements?",
          a: "- **Splits** divide one payment into several category legs of one transaction.\n- **Tags** are ad-hoc labels for filtering — no shared metadata.\n- **Reimbursements** are a 1:1 settlement between an expense and a refund.\n- **Links** are N transactions sharing one named bundle (title, optional planned date, kind icon). A transaction can belong to **at most one** link.",
        },
        {
          q: "Does a link change my budgets or KPIs?",
          a: "**No.** Reports keep using each transaction's own `amount` against its own category and date. The link total shown in the sheet (\"Linked total\") is purely descriptive — for orientation, not double-counting.",
        },
        {
          q: "Only part of a transaction belongs to the purchase",
          a: "**Split the transaction first** (Add → Split), then link only the slice that belongs to the bundle. The link itself never stores partial amounts — that keeps accounting unambiguous.",
        },
        {
          q: "What happens when I remove the last member?",
          a: "You're asked to confirm: removing the last transaction deletes the link itself. Until then, deleting individual transactions just removes them from the link.",
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
      intro:
        "Diese Bausteine arbeiten zusammen, um dir ein vollständiges Bild deines Geldes zu geben. Stell dir einen Satz Umschläge, ein Notizbuch und einen Aktenschrank vor — nur digital.",
      items: [
        {
          q: "Konto",
          a: "Ein realer Geldbehälter: Bankkonto, Bargeld, Kreditkarte, Sparbuch. Jede Buchung gehört zu genau einem Konto (Übertrag zu zweien).\n\n**Beispiel:** Du hast vielleicht *UBS Giro*, *PostFinance Spar*, *Bargeld* und *Visa Kreditkarte*. Wenn du mit der Visa einkaufen gehst, wird die Buchung auf das Konto *Visa Kreditkarte* gebucht. Wenn du am Bankomat Bargeld abhebst, ist das ein Übertrag von *UBS Giro* nach *Bargeld*.",
        },
        {
          q: "Buchung",
          a: "Eine einzelne Geldbewegung: Ausgabe, Einnahme oder Übertrag. Mit Datum, Betrag, Konto, Kategorie und optional Tags, Anhängen, Notizen.\n\n**Beispiel:** Am 5. Juni gibst du 64.50 CHF bei der Migros mit der Debitkarte aus. Das ist eine **Ausgabe** von 64.50, auf dem Konto *UBS Giro*, in der Kategorie *Lebensmittel*. Am 30. Juni zahlt dir dein Arbeitgeber 5,200 CHF Lohn — das ist eine **Einnahme** auf *UBS Giro*, Kategorie *Lohn*. 200 CHF von Giro auf Sparbuch zu überweisen ist ein **Übertrag**.",
        },
        {
          q: "Kategorie",
          a: "Wofür das Geld war (Lebensmittel, Gehalt, Miete…). Kategorien sind gruppiert; die meisten sind monatliche *Umschläge*, für die du Budgets setzen kannst.\n\n**Beispiel:** Du legst Kategorien an wie *Lebensmittel*, *Restaurant*, *Kaffee*, *Miete*, *Strom*, *Lohn* und *Urlaubsrücklage*. Wenn du einen Kauf erfassen willst, wählst du die Kategorie, damit die App weiss, aus welchem Umschlag das Geld kommen soll. Eine Rückerstattung von einer Freundin buchst du ebenfalls in eine Kategorie — oder lässt die Kategorie weg, damit sie dein Budget nicht beeinflusst.",
        },
        {
          q: "Kategoriegruppe",
          a: "Bündelt verwandte Kategorien (z. B. *Essen* enthält Lebensmittel, Restaurant, Kaffee). Wird in Auswertungen und für gemeinsame Sweep-Einstellungen verwendet.\n\n**Beispiel:** Deine Gruppe *Essen* enthält *Lebensmittel*, *Restaurant* und *Kaffee*. Deine Gruppe *Fixkosten* enthält *Miete*, *Versicherung* und *Telefon*. In der Aufschlüsselung unter *Auswertungen* siehst du dann die Summen pro Gruppe — und erkennst auf einen Blick, ob du mehr für Essen oder für Fixkosten ausgibst.",
        },
        {
          q: "Umschlag / Budget",
          a: "Der monatliche Betrag, den du in einer Kategorie ausgeben willst. Die Budget-Seite zeigt den verbleibenden Stand pro Umschlag.\n\n**Beispiel:** Du budgetierst 400 CHF für *Lebensmittel* im Juni. Der Umschlag startet mit 400. Nach dem Einkauf bei Migros für 120 bleiben 280. Wenn du später 50 beim Bäcker ausgibst, sinkt er auf 230. Wenn du eine Rückerstattung von 30 CHF für ein gemeinsames Abendessen bekommst (verknüpft mit einer IOU), wächst der Umschlag wieder auf 260 — weil du einen Teil des Essensgeldes zurückbekommen hast.\n\nAm Monatsende wird das, was noch im Umschlag ist (oder das Defizit), durch deine Sweep- und Rollover-Einstellungen verarbeitet.",
        },
        {
          q: "Scope",
          a: "Ein Filter, der die App vorbelegt — z. B. eine Reise, ein Projekt, ein gemeinsamer Haushalt. Der aktive Scope beeinflusst Übersicht, Buchungsliste und Add-Formular.\n\n**Wofür er gedacht ist:** Ein Scope ist für **einmalige Ereignisse** (Urlaub, Musikfestival, Hochzeit), bei denen du alle dazugehörigen Ausgaben an einem Ort sammeln und dann mit einer einzigen sichtbaren Geld-Umverteilung **abschliessen** willst. Wenn du einen Scope schliesst, wird der Gesamtbetrag virtuell aus einer Finanzierungskategorie in die eigene Kategorie des Scopes verschoben — so siehst du die Gesamtkosten in einer transparenten \"Zahlung\".\n\n**Wofür er NICHT gedacht ist:** Für reguläre monatliche Ausgaben. Erstelle keinen Scope für *Lebensmittel* oder *Restaurant* — die gehören in normale Budgetkategorien mit monatlichen Umschlägen.\n\n**Beispiel:** Du erstellst einen Scope *Glastonbury 2025* mit einem geplanten Budget von 1,200 CHF, finanziert aus deiner Kategorie *Freizeit*. Während dem Festival erfasst du Tickets, Camping-Ausrüstung, Essen und Getränke — alles mit dem Scope markiert. Wenn du zurück bist, schliesst du den Scope: die App verschiebt 1,180 CHF (was du tatsächlich ausgegeben hast) von *Freizeit* nach *Glastonbury 2025*. Jetzt siehst du die gesamten Festival-Kosten als eine Zeile, und dein *Freizeit*-Umschlag wurde entsprechend reduziert. Dann schaltest du zurück auf den Standard-Scope — und dein normales Haushaltsbudget ist wieder da.",
        },
        {
          q: "IOU / erstattungsfähig",
          a: "Eine Buchung, die markiert wurde, weil dir jemand Geld schuldet (oder umgekehrt). Offene IOUs bleiben sichtbar, bis du eine Rückzahlung erfasst, sie als abgegolten markierst, abschreibst oder stornierst.\n\n**Beispiel:** Du zahlst 120 CHF für ein Team-Abendessen mit deiner Kreditkarte; dein Kollege schuldet dir die Hälfte. Du buchst die Ausgabe als 120 CHF, aktivierst **Erstattungsfähig** und gibst *Kollegin Anna* als Gegenpartei an. Die vollen 120 belasten deinen *Restaurant*-Umschlag, aber eine offene IOU über 60 erscheint auf der Übersicht. Wenn Anna dir via TWINT zurückzahlt, erfasst du die Rückzahlung — die IOU schließt sich und dein *Restaurant*-Umschlag wird um 60 wieder aufgestockt.",
        },
        {
          q: "Offene Buchung",
          a: "Ein Eintrag, der aus einem externen System (oder über die öffentliche API) importiert wurde und noch nicht gebucht ist. Du prüfst und bestätigst oder lehnst ab.\n\n**Beispiel:** Deine Bank-API schiebt eine Buchung: *Coop, 45.30 CHF, 12. Juni*. Sie landet unter **Offen**, weil die App noch nicht weiss, welcher Kategorie sie gehört. Du öffnest sie, weist *Lebensmittel* zu und klickst **Bestätigen**. Jetzt ist sie eine echte Buchung in deinem Kontenbuch.",
        },
        {
          q: "Wiederkehrende Regel",
          a: "Eine Vorlage, die Buchungen nach Zeitplan erzeugt (Miete, Gehalt, Abos). Einzelne Vorkommen lassen sich überspringen, ändern oder posten.\n\n**Beispiel:** Deine Miete von 1,450 CHF fällt jeden 1. des Monats an. Du legst eine Regel an: Betrag 1,450, Kategorie *Miete*, Konto *UBS Giro*, Tag-im-Monat = 1. Die Übersicht zeigt das nächste anstehende Vorkommen. Falls du im Urlaub bist und der Vermieter die Abbuchung auf den 5. verschiebt, kannst du dieses eine Vorkommen ändern, ohne die Regel anzufassen.\n\n**Wie der Zeitplan gebildet wird (v2-Engine):**\n- **Intervall** ist eine ganze Monatszahl (1 = monatlich, 3 = quartalsweise, 12 = jährlich). Kein Wochen-Takt.\n- **Ausführung** und **Berichtsperiode** werden *unabhängig* konfiguriert, jeweils mit eigener Tagesregel (`FixedDay N`, `LastDay`, `FirstDay`). Beispiel: am letzten Werktag ausführen, aber für den 1.–31. berichten.\n- **Wochenend-Anpassung** (`None` / `PreviousBusinessDay` / `NextBusinessDay`) verschiebt nur das *Ausführungsdatum*; die Berichtsperiode bleibt am ursprünglichen Fälligkeitstag verankert.\n- **Perioden-Verschiebung** (−3…+3) erlaubt, jetzt für eine vergangene oder zukünftige Periode zu posten (z. B. MwSt-Abrechnung im April für Q1: Offset −1).\n- Beschreibung und Notiz unterstützen die Tokens `${date}`, `${dueDate}`, `${periodFrom}`, `${periodTo}`, `${runNumber}`, mit Datumsformatierern wie `dd.MM.yyyy`, `MMMM`, `Q` (Quartal), `S` (Halbjahr), `T` (Trimester), `ww` (ISO-Woche). Ältere Tokens (`${periodLabel}`, `${today}`, `${year}`, …) werden nicht mehr unterstützt — der Editor warnt, wenn eine gespeicherte Vorlage sie noch verwendet.",
        },
        {
          q: "Abgleich",
          a: "Vergleich der App-Salden mit der Realität. Die Abgleich-Seite zeigt jede Abweichung zwischen gebuchten Salden, Sparumschlägen und ungekehrtem Geld.\n\n**Beispiel:** Dein echter Kontoauszug sagt, dein Giro hat 3,240 CHF. Die App zeigt 3,440 CHF. Der Abgleich zeigt eine Drift von 200 CHF. Du stellst fest: du hast einen Übertrag aufs Sparbuch gebucht, aber die Gegenbuchung vergessen. Nach der Korrektur ist die Drift null — alles stimmt.",
        },
        {
          q: "Sweep / Sparziel",
          a: "Am Monatsende kann übriges Budget aus einem Umschlag in eine Sparkategorie *gekehrt* werden. Ein Standardziel und Gruppen-Overrides sind möglich.\n\n**Was passiert mit übrigem Geld?**\nStell dir vor, dein *Lebensmittel*-Umschlag hatte 400 CHF für Juni. Du hast nur 350 ausgegeben. Am Ende des Monats können die verbleibenden 50 CHF per **Sweep** in deine *Urlaubsrücklage* (oder ein anderes konfiguriertes Sparziel) überführt werden. Die 50 CHF gelten dann als gespart, und der *Lebensmittel*-Umschlag wird für den frischen Juli auf null zurückgesetzt.\n\n**Was passicht bei Überziehung?**\nStell dir vor, du hast 400 CHF für *Lebensmittel* budgetiert, aber 450 ausgegeben. Am Monatsende zeigt der Umschlag −50. Je nach Einstellung bleibt das Defizit bestehen (du startest den Juli bereits mit 50 im Minus), oder es wird durch *Umverteilen* von einem anderen Umschlag gedeckt. Die App verschiebt nie stillschweigend Geld — du entscheidest immer, was passiert.\n\nSpar-Kategorien (wie *Urlaubsrücklage* oder *Notgroschen*) funktionieren anders: Sie haben einen **laufenden Saldo**, kein Monatsbudget. Geld summiert sich Monat für Monat, bis du daraus ausgibst.",
        },
        {
          q: "Anhang",
          a: "Eine Datei (Quittung, Rechnung), die einer Buchung beiliegt. Optional über Nextcloud synchronisierbar.\n\n**Beispiel:** Nach dem Bezahlen von 89 CHF beim Zahnarzt fotografierst du die Quittung und hängst sie an die Buchung an. Sechs Monate später, wenn deine Krankenkasse einen Nachweis verlangt, öffnest du die Buchung — und die Quittung ist gleich zur Hand.",
        },
        {
          q: "Tag",
          a: "Ein freies Label für Buchungen, das du durchsuchen kannst. Praktisch für Querschnitte, die nicht zu einer Kategorie passen (z. B. *urlaub-2025*).\n\n**Beispiel:** Du markierst Flug, Hotel und Restaurantbesuche mit *#paris-2025*. Später suchst du nach diesem Tag und siehst die Gesamtkosten der Reise über alle Kategorien hinweg — ohne für jeden Ausgabentyp eine separate *Paris*-Kategorie anlegen zu müssen.",
        },
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
        {
          q: "Beeinflussen Umverteilungen das Monatsbudget einer Kategorie?",
          a: "**Nein.** Eine Umverteilung (`category_reallocations`) verschiebt nur den **laufenden Saldo** zwischen **Spar-Kategorien**. Die Monatsbudget-Ansicht (Umschläge / Budget-Zusammenfassung) wird ausschliesslich aus echten `transactions`-Zeilen berechnet — Umverteilungen werden dort komplett ignoriert.\n\n**Was das konkret heisst:**\n- 100 CHF von *Urlaubsrücklage* → *Notgroschen* zu verschieben ändert beide Spar-Salden. Kein Monatsumschlag wird berührt.\n- Beim Schliessen eines Scopes wird eine Umverteilung von der **Finanzierungs-Kategorie** → der **Scope-Kategorie** geschrieben. Damit diese Umverteilung wirklich einen Saldo bewegt, muss die Finanzierungskategorie eine **Spar-Kategorie** (laufender Saldo) sein. Bei einem normalen Monats-Umschlag wird die Reallocation-Zeile zwar erfasst, der *diesen Monat ausgegeben*-Wert des Umschlags ändert sich aber nicht — die Original-Buchungen aus dem Scope bleiben in den Kategorien, die du beim Buchen gewählt hast.\n- **Faustregel:** Behandle Scopes als *Spar → Spar*-Bewegung. Finanziere sie aus einem Spar-Umschlag (z. B. *Spass-Topf*, *Reise-Topf*), dann erhält die Scope-Kategorie am Ende den umverteilten Gesamtbetrag.",
        },
        {
          q: "Könnten Umverteilungen auch Monatsbudgets beeinflussen?",
          a: "Technisch ja, aber das würde die Bedeutung eines Umschlags ändern. Heute beantwortet ein Umschlag die Frage *„wie viel habe ich in dieser Kategorie diesen Monat tatsächlich ausgegeben?\"* — ausschliesslich aus Buchungen, was den Abgleich mit dem Bankauszug einfach hält.\n\nWürden Umverteilungen einbezogen, würde der Umschlag stattdessen sagen *„wie viel Budget hat diese Kategorie nach manuellen Anpassungen am Ende übrig?\"* Drei Nebenwirkungen wären abzuwägen:\n- **Doppelzählungs-Risiko.** Ein Scope-Schluss verteilt bereits per Umverteilung; würden Umschläge ebenfalls darauf reagieren, würde derselbe CHF doppelt in Berichten auftauchen, ausser jede Aggregation zieht die Reallocation-Seite explizit wieder ab.\n- **Rückwirkende Drift.** Eine bearbeitete Umverteilung würde stillschweigend die Budgetzahlen vergangener Monate verändern.\n- **Auswertungen & Prognose.** Trends, Prognose und die Budget-Balance-Karte müssten zwischen *Cash-Flow-Wahrheit* (nur Buchungen) und *Geplant-vs-angepasst-Wahrheit* (Buchungen + Umverteilungen) wählen.\n\nDeshalb hält Cashflow die beiden Ebenen bewusst getrennt: **Buchungen** treiben Monatsumschläge, **Umverteilungen** treiben Spar-Salden und Scope-Schluss.",
        },
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
    {
      id: "ai",
      icon: Sparkles,
      title: "KI-Assistent",
      intro:
        "Optionaler Chat-Assistent, der ein von dir bereitgestelltes Modell nutzt. Erlaubt sind nur Themen rund um diese App: persönliche Finanzen, Bedienung, Datenschutz.",
      items: [
        { q: "Wie aktiviere ich ihn?", a: "**Einstellungen → KI-Assistent**: einschalten, **API Base URL** (z. B. `https://api.openai.com/v1`), **Modellname** (z. B. `gpt-4o-mini`) und **API Token** eintragen. *Verbindung testen*, dann *Speichern*." },
        { q: "Welche Provider funktionieren?", a: "Alles, was die OpenAI-Chat-Completions-API spricht: OpenAI, OpenRouter, Groq, Together, lokal **Ollama** (`http://host:11434/v1`), **LM Studio**, **vLLM**, **llama.cpp**-Server usw." },
        { q: "Was kann er?", a: "Add-Formular vorausfüllen aus Sätzen wie *„Ich habe 50 im Coop bezahlt für Lebensmittel, Kreditkarte\"*; Fragen zu deinen Daten beantworten (*„Wo habe ich letzten Monat am meisten ausgegeben?\"*) via Lesetools; App-Funktionen und Datenschutz erklären. Alles andere lehnt er ab." },
        { q: "Schreibt er in meine Daten?", a: "Nein. Er **bereitet nur einen Entwurf** für das Add-Formular vor — speichern musst du selbst. Alle anderen Tools lesen nur." },
        { q: "Was wird an den Provider gesendet?", a: "Deine Nachrichten plus die Ergebnisse der Lesetools, die das Modell aufruft (Buchungen, Kontostände, Kategoriesummen). Siehe [Datenschutzseite](/privacy) für den vollständigen Datenfluss." },
        { q: "Wo wird mein API Token gespeichert?", a: "Serverseitig in der Tabelle `ai_credentials`. Er wird **nicht** an den Browser zurückgegeben, aber der Server-Betreiber kann ihn lesen — behandle ihn wie andere Zugangsdaten auf dieser Instanz." },
      ],
    },
    {
      id: "statements",
      icon: FileText,
      title: "Auszüge importieren",
      intro:
        "Lade unter „Auszüge" einen Konto- oder Kreditkartenauszug hoch. Die KI liest die Zeilen aus, danach vergleicht die App sie mit deinen Buchungen und zeigt Fehlendes, Doppeltes oder falsch Gebuchtes.",
      items: [
        {
          q: "Welche Dateitypen kann ich hochladen?",
          a: "- **PDF** — der digitale Auszug der Bank. Der Text wird lokal extrahiert, nur der Text geht an deinen KI-Endpoint.\n- **Bilder** — PNG, JPEG, WebP oder GIF, z. B. ein **Foto oder Screenshot** eines Papierauszugs oder der Banking-App. Das Bild wird als Bild an den KI-Endpoint geschickt — die Verbindung für *Auszug auslesen* muss also Vision unterstützen.\n\nEin gescanntes PDF ohne Textebene kann nicht gelesen werden — mach stattdessen ein Foto/Screenshot davon und lade dieses als Bild hoch.",
        },
        {
          q: "Wie importiere ich einen Auszug?",
          a: "1. **Auszüge** öffnen und das passende **Konto** wählen.\n2. Datei wählen (PDF oder Bild).\n3. **Datumstoleranz** setzen (Standard 3 Tage) — Buchungsdaten in App und Bank stimmen selten exakt überein.\n4. **Beträge invertieren** aktivieren, wenn der Auszug Ausgaben positiv darstellt (bei Kreditkarten üblich).\n5. Import starten: Die KI extrahiert die Zeilen, danach vergleicht ein deterministischer Abgleich sie mit deinen Buchungen.",
        },
        {
          q: "Wie funktioniert der Abgleich?",
          a: "Der Abgleich passiert im Code, nicht in der KI:\n- **Betrag muss auf den Rappen stimmen.** Splits werden vorher pro Split-Gruppe summiert.\n- **Datum** muss im Toleranzfenster liegen.\n- **Textähnlichkeit** sortiert nur die Kandidaten und entscheidet *exakt* vs. *wahrscheinlich* — sie erzeugt nie allein einen Treffer.\n- Jede Buchung kann **höchstens einmal** zugeordnet werden, gleiche Beträge werden also nie doppelt gematcht.",
        },
        {
          q: "Was bedeuten die Gruppen im Ergebnis?",
          a: "- **Fehlend** — steht im Auszug, fehlt in der App. Mit einem Klick anlegen (Add-Formular ist vorausgefüllt).\n- **Wahrscheinlich** — vermuteter Treffer; bestätigen oder zurücksetzen.\n- **Zugeordnet** — exakte Treffer, nichts zu tun.\n- **Ignoriert** — Zeilen, die du als irrelevant markiert hast (Gebühren, Saldovorträge).\n- **Nicht im Auszug** — Buchungen in der App im Auszugszeitraum, die der Auszug nicht enthält: meist Duplikat, falsches Datum oder falsches Konto.",
        },
        {
          q: "Was wird an den KI-Provider gesendet?",
          a: "Der Auszugstext (PDF) bzw. das Bild, dazu Kontowährung und heutiges Datum — sonst nichts aus deinen Daten. Der Abgleich läuft danach ohne KI auf dem Server. Verbindung wählst du unter **Einstellungen → KI-Assistent → Auszug auslesen**; der übliche Fallback auf die nächste aktive Verbindung gilt.",
        },
      ],
    },
    {
      id: "webhooks",
      icon: Webhook,
      title: "Webhooks",
      intro:
        "Ausgehende Webhooks benachrichtigen einen externen Dienst (z. B. n8n, Zapier, eigenes Script), sobald eine Buchung angelegt wird. Praktisch um z. B. gemeinsame Haushaltsausgaben an Flatastic weiterzureichen.",
      items: [
        {
          q: "Was löst einen Webhook aus?",
          a: "Ein Webhook wird für jede neu angelegte Buchung gefeuert, aus einer dieser Quellen:\n- **`transaction.created.manual`** — über das Add-Formular gespeichert.\n- **`transaction.created.recurring`** — automatisch durch eine wiederkehrende Regel gebucht.\n- **`transaction.created.api`** — über die öffentliche REST-API erfasst.\n\nÄnderungen, Löschungen und Umverteilungen lösen **keinen** Webhook aus (bewusste Vereinfachung des Vertrags).",
        },
        {
          q: "Wie lege ich einen an?",
          a: "**Einstellungen → Webhooks**: Name (frei wählbar), Ziel-**URL** (muss vom Server erreichbar sein), optional ein **Auth-Header** (Name + Wert). Der Header wird bei jedem Request mitgesendet — die *Header Auth*-Node in n8n, Zapiers *Custom Webhook* oder dein eigener Server kann ihn prüfen.\n\nMit **Test senden** schickst du sofort einen synthetischen Payload und prüfst den Empfänger.",
        },
        {
          q: "Zustellung, Retries und Logging",
          a: "Die Zustellung ist **für dich fire-and-forget** — die Buchung wird zuerst gespeichert, der Webhook danach im Hintergrund ausgeliefert. Pro Webhook werden bis zu **3 Versuche** gemacht (1 s und 4 s Backoff, 10 s Timeout je Versuch). Jeder Versuch wird geloggt nach:\n- **stdout** (strukturiertes JSON), nützlich beim Selbsthosten,\n- ins **Audit-Log** (`Einstellungen → Audit-Log`, Aktion `custom`, Kind `webhook.delivery`) mit Status, Versuchen, Dauer und Fehlermeldung.\n\nEs gibt keine persistente Queue: scheitern alle 3 Versuche, wird der Versand verworfen und nur der Fehler steht im Audit-Log. Künftige Notification-Kanäle (z. B. Gotify) hängen sich an denselben Dispatcher.",
        },
        {
          q: "Aufbau des Payloads",
          a: "`POST <deine-url>` mit `Content-Type: application/json` und deinem konfigurierten Auth-Header. Body:\n\n```json\n{\n  \"event\": \"transaction.created.manual\",\n  \"delivered_at\": \"2026-06-18T10:30:00.000Z\",\n  \"delivery_id\": \"a1c8e9d2-2f4d-4c11-9b1e-7e2a3a3d40e5\",\n  \"transaction\": {\n    \"id\": \"6b6a7c80-1f4a-4c2c-8f7d-2c0b3f1d9d11\",\n    \"occurred_on\": \"2026-06-18\",\n    \"amount\": 42.50,\n    \"destination_amount\": null,\n    \"type\": \"expense\",\n    \"source_account_id\": \"b6e3d0fa-…\",\n    \"destination_account_id\": null,\n    \"category_id\": \"3a9b1f7c-…\",\n    \"description\": \"Migros\",\n    \"note\": null,\n    \"tags\": [\"lebensmittel\", \"haushalt\"],\n    \"split_group_id\": null,\n    \"recurring_rule_id\": null,\n    \"created_at\": \"2026-06-18T10:30:00.142Z\"\n  }\n}\n```\n\nHinweise:\n- `amount` ist immer **positiv**; das Vorzeichen ergibt sich aus `type` (`expense` / `income` / `transfer`).\n- `destination_amount` ist nur bei Fremdwährungs-Überträgen gesetzt.\n- `tags` ist ein flaches String-Array, damit Empfänger ohne zweiten API-Call verzweigen können (z. B. *nur an Flatastic weiterleiten, wenn `tags` `haushalt` enthält*).\n- `delivery_id` ist pro Auslieferungs-Batch eindeutig — eignet sich als **Idempotenz-Schlüssel** auf der Empfängerseite.\n- IDs verweisen auf Zeilen in deiner Cashflow-DB; lesbare Konto-/Kategorienamen holst du dir bei Bedarf über die öffentliche REST-API.",
        },
        {
          q: "Beispiel: Weiterleitung an Flatastic via n8n",
          a: "1. In n8n einen Workflow mit **Webhook**-Trigger anlegen (Methode `POST`, *Header Auth* mit demselben Namen/Wert wie in Cashflow).\n2. **IF**-Node zum Filtern: z. B. nur weitermachen, wenn `{{$json.transaction.tags}}` `haushalt` enthält.\n3. **HTTP Request**-Node, der die Flatastic-API mit den gemappten Feldern aufruft.\n4. Workflow aktivieren, dann in Cashflow **Test senden** klicken — der Test-Event sollte in n8n ankommen.",
        },
        {
          q: "Sicherheit",
          a: "- Nur **HTTPS**-URLs (HTTP ist ausserhalb von localhost gesperrt).\n- Der Auth-Header-Wert liegt serverseitig und wird **nie geloggt** (weder nach stdout noch ins Audit-Log).\n- Jeder Webhook ist auf deinen User beschränkt (RLS): niemand sonst kann ihn sehen, ändern oder auslösen.\n- Der Server-Betreiber kann den gespeicherten Header-Wert in der DB lesen — behandle ihn wie andere Zugangsdaten auf dieser Instanz.",
        },
      ],
    },
    {
      id: "links",
      icon: Link2,
      title: "Buchungs-Verknüpfungen",
      intro:
        "Bündle mehrere einzeln gebuchte Transaktionen, die zum selben realen Einkauf gehören (Geschenkkarte auf zwei Karten gesplittet, Konzertticket + Essen vor Ort, IKEA-Trip Bar + Karte). Die Buchungen zählen weiterhin einzeln in Budgets, Kategorien und KPIs — die Verknüpfung ist nur eine benannte Sicht darüber.",
      items: [
        {
          q: "Was ist der Unterschied zu Splits, Tags und Erstattungen?",
          a: "- **Splits** teilen **eine** Zahlung in mehrere Kategorie-Anteile **einer** Buchung.\n- **Tags** sind freie Labels fürs Filtern — kein gemeinsames Metadatum.\n- **Erstattungen** sind die 1:1-Verrechnung zwischen Ausgabe und Rückzahlung.\n- **Verknüpfungen** bündeln N Buchungen unter einem Titel (mit optionalem Plandatum und Icon). Eine Buchung kann zu **höchstens einer** Verknüpfung gehören.",
        },
        {
          q: "Ändert eine Verknüpfung meine Budgets oder Auswertungen?",
          a: "**Nein.** Die Auswertungen rechnen weiter mit dem `amount` jeder einzelnen Buchung in ihrer eigenen Kategorie und ihrem Datum. Der „Verknüpfte Gesamtbetrag\" im Sheet ist rein deskriptiv — zur Orientierung, nicht zur Doppelzählung.",
        },
        {
          q: "Nur ein Teil einer Buchung gehört dazu",
          a: "**Splitte die Buchung zuerst** (Neu → Splitten) und verknüpfe nur den passenden Teil. Die Verknüpfung selbst speichert keine Teilbeträge — das hält die Buchhaltung eindeutig.",
        },
        {
          q: "Was passiert, wenn ich die letzte Buchung entferne?",
          a: "Du wirst gefragt: das Entfernen der letzten Buchung **löscht die Verknüpfung selbst**. Solange noch mehrere Mitglieder drin sind, entfernt das Löschen einer Buchung sie nur aus der Verknüpfung.",
        },
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
