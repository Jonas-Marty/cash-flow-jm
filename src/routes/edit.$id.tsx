import { createFileRoute } from "@tanstack/react-router";
import { TransactionForm } from "./add";

export const Route = createFileRoute("/edit/$id")({
  component: EditTransactionRoute,
});

function EditTransactionRoute() {
  const { id } = Route.useParams();
  return <TransactionForm editId={id} />;
}