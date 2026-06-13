import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchSettings, updateActiveScope } from "@/lib/finance";

/** Persistent, account-wide active scope backed by the user's settings row. */
export function useActiveScopeId(): [string | null, (id: string | null) => Promise<void>] {
  const queryClient = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });

  const setId = React.useCallback(async (id: string | null) => {
    const previous = queryClient.getQueryData<Awaited<ReturnType<typeof fetchSettings>>>(["settings"]);
    if (previous) queryClient.setQueryData(["settings"], { ...previous, active_scope_id: id });
    try {
      await updateActiveScope(id);
    } catch (error) {
      if (previous) queryClient.setQueryData(["settings"], previous);
      throw error;
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    }
  }, [queryClient]);

  return [settingsQ.data?.active_scope_id ?? null, setId];
}