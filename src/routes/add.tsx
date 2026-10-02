import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TransactionForm, type AddPrefill } from "@/components/TransactionForm";

export const Route = createFileRoute("/add")({
  component: AddTransactionRoute,
});

function AddTransactionRoute() {
  // Read prefill from URL search params (set by deep links such as the
  // dashboard "Add refund" button). Kept untyped to avoid forcing every
  // <Link to="/add"> elsewhere to declare a search shape.
  const prefill = React.useMemo<AddPrefill>(() => {
    if (typeof window === "undefined") return {};
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("type");
    return {
      reimburse_for: sp.get("reimburse_for") ?? undefined,
      type: t === "income" || t === "expense" || t === "transfer" ? t : undefined,
      amount: cleanAmountParam(sp.get("amount")),
      source: sp.get("source") ?? undefined,
      counterparty: sp.get("counterparty") ?? undefined,
      account_name: sp.get("account_name") ?? undefined,
      category: sp.get("category") ?? undefined,
      category_name: sp.get("category_name") ?? undefined,
      description: sp.get("description") ?? undefined,
      note: sp.get("note") ?? undefined,
      occurred_on: sp.get("occurred_on") ?? undefined,
      iou_with: sp.get("iou_with") ?? undefined,
      iou_amount: cleanAmountParam(sp.get("iou_amount")),
      statement_line: sp.get("statement_line") ?? undefined,
      statement_import: sp.get("statement_import") ?? undefined,
      pending_id: sp.get("pending_id") ?? undefined,
      ignore_scope: sp.get("ignore_scope") === "1",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <TransactionForm editId={null} prefill={prefill} />;
}

/** Strip quotes/currency noise from an amount passed via URL (e.g. AI prefill). */
function cleanAmountParam(v: string | null): string | undefined {
  if (v == null) return undefined;
  const s = v.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/[^\d.,-]/g, "").replace(",", ".").trim();
  return s === "" ? undefined : s;
}
