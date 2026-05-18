import { z } from "zod";

/**
 * Shared validation logic for creating transactions.
 *
 * Used by:
 *  - the public REST API (`/api/public/transactions`)
 *  - server-side admin operations
 *
 * The UI in `src/routes/add.tsx` currently performs equivalent inline checks
 * (positive amount, source account required, transfer destination required and
 * different from source, category cleared on transfers). Future UI work should
 * migrate to use `transactionInputSchema` / `normalizeTransactionInput` so the
 * exact same rules apply everywhere.
 */

export const txTypeSchema = z.enum(["expense", "income", "transfer"]);

// Accept a number, or a string like "12.34" / "12,34" — mirrors UI parsing.
const amountSchema = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount must be greater than zero" });
      return z.NEVER;
    }
    // Round to 2 decimals to match currency precision used in the UI.
    return Math.round(n * 100) / 100;
  });

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

const trimmedNullable = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => {
      const t = s.trim();
      return t.length === 0 ? null : t;
    })
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? null : v));

export const transactionInputSchema = z
  .object({
    type: txTypeSchema,
    amount: amountSchema,
    occurred_on: isoDate.optional(),
    source_account_id: z.string().uuid(),
    destination_account_id: z.string().uuid().nullable().optional(),
    category_id: z.string().uuid().nullable().optional(),
    description: trimmedNullable(500),
    note: trimmedNullable(2000),
    destination_amount: amountSchema.optional().nullable(),
    fee_amount: amountSchema.optional().nullable(),
    fee_category_id: z.string().uuid().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "transfer") {
      if (!data.destination_account_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["destination_account_id"],
          message: "Destination account is required for transfers",
        });
      } else if (data.destination_account_id === data.source_account_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["destination_account_id"],
          message: "Destination account must differ from source account",
        });
      }
    }
    if (data.destination_amount != null && data.type !== "transfer") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destination_amount"],
        message: "destination_amount is only allowed on transfers",
      });
    }
    if (data.fee_amount != null && data.type !== "transfer") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fee_amount"],
        message: "fee_amount is only allowed on transfers",
      });
    }
    if (data.fee_amount != null && !data.fee_category_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fee_category_id"],
        message: "fee_category_id is required when fee_amount is set",
      });
    }
  });

export type TransactionInput = z.infer<typeof transactionInputSchema>;

/**
 * Normalize a validated input into the exact shape used by the
 * `transactions` table insert. Mirrors the payload built in `add.tsx`:
 *  - transfers clear `category_id`
 *  - non-transfers clear `destination_account_id`
 *  - `occurred_on` defaults to today (UTC date) when omitted
 */
export function normalizeTransactionInput(input: TransactionInput) {
  const occurred_on =
    input.occurred_on ??
    (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
  return {
    occurred_on,
    amount: input.amount,
    type: input.type,
    source_account_id: input.source_account_id,
    destination_account_id:
      input.type === "transfer" ? input.destination_account_id ?? null : null,
    category_id: input.type === "transfer" ? null : input.category_id ?? null,
    description: input.description,
    note: input.note,
    destination_amount:
      input.type === "transfer" ? input.destination_amount ?? null : null,
    fee_amount: input.type === "transfer" ? input.fee_amount ?? null : null,
    fee_category_id:
      input.type === "transfer" ? input.fee_category_id ?? null : null,
  };
}