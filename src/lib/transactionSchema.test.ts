import { describe, it, expect } from "vitest";
import { transactionInputSchema, normalizeTransactionInput } from "./transactionSchema";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";
const UUID_C = "33333333-3333-3333-3333-333333333333";

describe("transactionInputSchema", () => {
  it("accepts a minimal expense", () => {
    const r = transactionInputSchema.safeParse({
      type: "expense",
      amount: "12,50",
      source_account_id: UUID_A,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe(12.5);
  });

  it("rejects non-positive amounts", () => {
    expect(transactionInputSchema.safeParse({ type: "expense", amount: 0, source_account_id: UUID_A }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ type: "expense", amount: -1, source_account_id: UUID_A }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ type: "expense", amount: "abc", source_account_id: UUID_A }).success).toBe(false);
  });

  it("requires destination_account_id on transfers and forbids equal accounts", () => {
    expect(transactionInputSchema.safeParse({ type: "transfer", amount: 1, source_account_id: UUID_A }).success).toBe(false);
    expect(
      transactionInputSchema.safeParse({
        type: "transfer", amount: 1,
        source_account_id: UUID_A, destination_account_id: UUID_A,
      }).success,
    ).toBe(false);
    expect(
      transactionInputSchema.safeParse({
        type: "transfer", amount: 1,
        source_account_id: UUID_A, destination_account_id: UUID_B,
      }).success,
    ).toBe(true);
  });

  it("forbids destination_amount on non-transfer types", () => {
    expect(
      transactionInputSchema.safeParse({
        type: "expense", amount: 10, source_account_id: UUID_A, destination_amount: 5,
      }).success,
    ).toBe(false);
  });

  it("rounds amounts to two decimals", () => {
    const r = transactionInputSchema.safeParse({ type: "income", amount: 12.345, source_account_id: UUID_A });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe(12.35);
  });
});

describe("normalizeTransactionInput", () => {
  it("clears category_id on transfers and destination_account_id on non-transfers", () => {
    const transfer = transactionInputSchema.parse({
      type: "transfer", amount: 100,
      source_account_id: UUID_A, destination_account_id: UUID_B,
      category_id: UUID_C,
    });
    expect(normalizeTransactionInput(transfer).category_id).toBeNull();
    expect(normalizeTransactionInput(transfer).destination_account_id).toBe(UUID_B);

    const expense = transactionInputSchema.parse({
      type: "expense", amount: 100, source_account_id: UUID_A,
      destination_account_id: UUID_B, category_id: UUID_C,
    });
    expect(normalizeTransactionInput(expense).destination_account_id).toBeNull();
    expect(normalizeTransactionInput(expense).category_id).toBe(UUID_C);
  });

  it("defaults occurred_on to today's UTC date when omitted", () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const got = normalizeTransactionInput(
      transactionInputSchema.parse({ type: "income", amount: 1, source_account_id: UUID_A }),
    );
    expect(got.occurred_on).toBe(`${yyyy}-${mm}-${dd}`);
  });

  it("preserves explicit occurred_on", () => {
    const got = normalizeTransactionInput(
      transactionInputSchema.parse({
        type: "income", amount: 1, source_account_id: UUID_A, occurred_on: "2024-03-15",
      }),
    );
    expect(got.occurred_on).toBe("2024-03-15");
  });
});