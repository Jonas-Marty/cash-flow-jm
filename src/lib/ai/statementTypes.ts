// Client-safe shared types for statement import.

export type StatementLineMatchStatus =
  | "exact"
  | "probable"
  | "unmatched"
  | "ignored"
  | "resolved";

export interface StatementLine {
  id: string;
  line_no: number;
  booking_date: string | null;
  value_date: string | null;
  description: string;
  amount: number;
  raw_text: string | null;
  match_status: StatementLineMatchStatus;
  matched_transaction_id: string | null;
  match_score: number | null;
  decision: string | null;
  /** AI-guessed fields for lines with no matching transaction yet. */
  suggested_description?: string | null;
  suggested_category_id?: string | null;
  suggested_tags?: string[] | null;
}

export interface StatementImport {
  id: string;
  account_id: string;
  file_name: string;
  period_from: string | null;
  period_to: string | null;
  closing_balance: number | null;
  currency_code: string | null;
  status: string;
  model: string | null;
  match_window_days: number;
  created_at: string;
}

/** A transaction (or summed split group) in the app that the statement did not cover. */
export interface UnmatchedAppTransaction {
  key: string;
  transaction_id: string;
  split_group_id: string | null;
  occurred_on: string;
  amount: number;
  description: string;
}

export interface StatementImportDetail {
  import: StatementImport;
  lines: StatementLine[];
  matched: Record<string, { occurred_on: string; amount: number; description: string }>;
  unmatched_app: UnmatchedAppTransaction[];
}