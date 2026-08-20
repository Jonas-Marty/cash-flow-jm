import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/client-auth-middleware";

/**
 * Place search proxied through the server so we can set the User-Agent that
 * OpenStreetMap Nominatim requires (browsers refuse to set it) and keep the
 * usage policy in one place. No API key needed.
 */
export const searchPlaces = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        q: z.string().trim().min(2).max(200),
        lang: z.string().trim().max(10).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", data.q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "6");
    url.searchParams.set("addressdetails", "0");
    try {
      const res = await fetch(url.toString(), {
        headers: {
          "User-Agent": "CashflowApp/1.0 (transaction location picker)",
          "Accept-Language": data.lang || "de,en",
          Accept: "application/json",
        },
      });
      if (!res.ok) return { results: [], error: "Search unavailable" };
      const raw = (await res.json()) as unknown;
      if (!Array.isArray(raw)) return { results: [], error: null };
      const results = raw
        .map((r) => {
          const o = r as Record<string, unknown>;
          const lat = Number(o.lat);
          const lon = Number(o.lon);
          const name = typeof o.display_name === "string" ? o.display_name : "";
          if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return null;
          return { label: name, latitude: lat, longitude: lon };
        })
        .filter((x): x is { label: string; latitude: number; longitude: number } => !!x);
      return { results, error: null };
    } catch {
      return { results: [], error: "Search unavailable" };
    }
  });