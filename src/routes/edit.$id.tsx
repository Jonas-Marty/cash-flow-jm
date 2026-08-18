import { createFileRoute } from "@tanstack/react-router";
import { TransactionForm } from "./add";

export const Route = createFileRoute("/edit/$id")({
  // `back` carries the transaction-list filters so they survive the round trip.
  validateSearch: (search: Record<string, unknown>) => ({
    back:
      search.back && typeof search.back === "object"
        ? (search.back as Record<string, unknown>)
        : undefined,
  }),
  component: EditTransactionRoute,
});

function EditTransactionRoute() {
  const { id } = Route.useParams();
  const { back } = Route.useSearch();
  return <TransactionForm editId={id} backSearch={back} />;
}