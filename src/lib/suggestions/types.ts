import type { Transaction, Account, Category, TxType } from "@/lib/finance";

export type TransactionDraft = {
  type?: TxType;
  amount?: number;
  source_account_id?: string;
  destination_account_id?: string | null;
  category_id?: string | null;
  payee?: string | null;
  note?: string | null;
  occurred_on?: string;
};

export type SuggestionContext = {
  type: TxType;
  amount: string; // raw user input
  amountNum: number | null;
  payee: string;
  note: string;
  sourceId: string;
  categoryId: string;
  date: Date;
  recentTransactions: Transaction[];
  accounts: Account[];
  categories: Category[];
};

export type SuggestionSource = "history" | "payee_match" | "tag" | "ai" | "receipt" | (string & {});

export type Suggestion = {
  id: string;
  score: number; // 0..1
  label: string;
  sublabel?: string;
  source: SuggestionSource;
  draft: TransactionDraft;
};

export type SuggestionProvider = {
  id: string;
  enabled: () => boolean;
  suggest: (ctx: SuggestionContext) => Promise<Suggestion[]>;
};
