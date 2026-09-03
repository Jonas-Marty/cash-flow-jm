import { z } from "zod";

/**
 * Validation for the public `/api/public/pending-transactions` endpoint.
 *
 * Mandatory: `source_account_id`, `amount`. Everything else is optional
 * — the user fills it in during the confirmation step in the app.
 */

const amountSchema = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount must be greater than zero" });
      return z.NEVER;
    }
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

export const pendingTxTypeSchema = z.enum(["expense", "income", "transfer"]);

export const pendingTransactionInputSchema = z
  .object({
    source_account_id: z.string().uuid(),
    amount: amountSchema,
    type: pendingTxTypeSchema.optional(),
    occurred_on: isoDate.optional(),
    destination_account_id: z.string().uuid().nullable().optional(),
    category_id: z.string().uuid().nullable().optional(),
    description: trimmedNullable(500),
    note: trimmedNullable(2000),
    destination_amount: amountSchema.optional().nullable(),
    external_source: trimmedNullable(120),
    external_ref: trimmedNullable(200),
    external_info: trimmedNullable(2000),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    // Metres. A phone fix indoors is routinely 20-100 m, so this is stored and
    // shown rather than rounded away.
    location_accuracy_m: z.number().min(0).max(100000).nullable().optional(),
    location_label: trimmedNullable(200),
    location_source: z.enum(["device", "manual", "search"]).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // The DB enforces this too; failing here gives a usable message instead of
    // a constraint violation.
    if ((data.latitude == null) !== (data.longitude == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latitude"],
        message: "latitude and longitude must be given together",
      });
    }
    if (
      data.type === "transfer" &&
      data.destination_account_id &&
      data.destination_account_id === data.source_account_id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destination_account_id"],
        message: "Destination account must differ from source account",
      });
    }
  });

export type PendingTransactionInput = z.infer<typeof pendingTransactionInputSchema>;

export function normalizePendingTransactionInput(input: PendingTransactionInput) {
  const occurred_on =
    input.occurred_on ??
    (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
  const type = input.type ?? "expense";
  return {
    source_account_id: input.source_account_id,
    amount: input.amount,
    type,
    occurred_on,
    destination_account_id:
      type === "transfer" ? input.destination_account_id ?? null : null,
    category_id: type === "transfer" ? null : input.category_id ?? null,
    description: input.description,
    note: input.note,
    destination_amount:
      type === "transfer" ? input.destination_amount ?? null : null,
    external_source: input.external_source,
    external_ref: input.external_ref,
    external_info: input.external_info,
    ...normalizeLocation(input),
  };
}

/** Rounded to ~11 cm, matching `round6` in lib/location. */
function normalizeLocation(input: PendingTransactionInput) {
  const hasPoint = input.latitude != null && input.longitude != null;
  if (!hasPoint) {
    return {
      latitude: null,
      longitude: null,
      location_accuracy_m: null,
      location_label: null,
      location_source: null,
    };
  }
  return {
    latitude: Math.round(input.latitude! * 1e6) / 1e6,
    longitude: Math.round(input.longitude! * 1e6) / 1e6,
    location_accuracy_m: input.location_accuracy_m ?? null,
    location_label: input.location_label,
    location_source: input.location_source ?? "device",
  };
}