import { createFileRoute } from "@tanstack/react-router";
import { TransactionForm } from "@/components/TransactionForm";

export const Route = createFileRoute("/edit/$id")({
  // `back` carries the search of the page the edit was opened from (the
  // transaction-list filters, or the Budgets month and open Verlauf) so it
  // survives the round trip; `backTo` names that page when it is not the list.
  validateSearch: (search: Record<string, unknown>): {
    back?: Record<string, unknown>;
    backTo?: "envelopes";
  } => ({
    ...(search.back && typeof search.back === "object"
      ? { back: search.back as Record<string, unknown> }
      : {}),
    ...(search.backTo === "envelopes" ? { backTo: "envelopes" as const } : {}),
  }),
  component: EditTransactionRoute,
});

function EditTransactionRoute() {
  const { id } = Route.useParams();
  const { back, backTo } = Route.useSearch();
  return <TransactionForm editId={id} backSearch={back} backTo={backTo} />;
}