import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { EnrichSummary } from "./pending.enrich.server";

/**
 * Fills suggestions for the caller's uncategorised pending rows.
 *
 * /pending calls it on mount without `force` to catch up on anything the
 * automatic triggers could not place (no AI connection online at the time);
 * the "Suggest" button calls it with `force` to take another look at rows
 * that were already examined.
 */
export const enrichPendingTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ force: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<EnrichSummary> => {
    const { enrichPending } = await import("./pending.enrich.server");
    return enrichPending(context.userId, { force: !!data.force });
  });
