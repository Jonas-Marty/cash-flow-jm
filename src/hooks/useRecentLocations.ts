import { useQuery } from "@tanstack/react-query";

import type { RecentLocation } from "@/components/LocationSection";
import { supabase } from "@/integrations/supabase/client";
import { locationFromRow } from "@/lib/location";

/**
 * The places this user has recently put a transaction at, most recent first
 * and one entry per spot.
 *
 * Shared by every screen that offers "somewhere I have been before": the add
 * form, the statement table and the pending table all want the same list, and
 * the shared query key means they also share one fetch.
 */
export function useRecentLocations(limit = 12) {
  return useQuery({
    queryKey: ["transactions", "recent_locations"],
    queryFn: async (): Promise<RecentLocation[]> => {
      const { data, error } = await supabase
        .from("transactions")
        .select(
          "latitude, longitude, location_accuracy_m, location_label, location_source, description, occurred_on",
        )
        .not("latitude", "is", null)
        .order("occurred_on", { ascending: false })
        .limit(50);
      if (error) throw error;
      const out: RecentLocation[] = [];
      const seen = new Set<string>();
      for (const row of data ?? []) {
        const loc = locationFromRow(row);
        if (!loc) continue;
        // ~11 m of precision: two pins closer than that are the same shop.
        const key = `${loc.latitude.toFixed(4)}|${loc.longitude.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...loc, description: row.description ?? null });
        if (out.length >= limit) break;
      }
      return out;
    },
  });
}
