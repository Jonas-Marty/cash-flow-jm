import { useQuery } from "@tanstack/react-query";

import { fetchTransactions } from "@/lib/finance";

/**
 * The last 200 transactions, which description and tag suggestions are
 * ranked from (how often, how recently, in what context).
 *
 * Shared by every screen that suggests as you type: the add form, the pending
 * card and table, and the statement table. One query key, so one fetch, and
 * the same suggestions wherever the user is typing.
 */
export function useRecentTransactions() {
  return useQuery({
    queryKey: ["transactions", "recent", 200],
    queryFn: () => fetchTransactions(200),
  });
}
