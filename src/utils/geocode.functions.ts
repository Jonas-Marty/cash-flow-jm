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
    type Hit = { label: string; latitude: number; longitude: number };
    const lang = data.lang || "de,en";

    // 1) Nominatim (blocks some datacenter IPs — hence the fallback below)
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", data.q);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "6");
      url.searchParams.set("addressdetails", "0");
      const res = await fetch(url.toString(), {
        headers: {
          "User-Agent": "CashflowApp/1.0 (transaction location picker)",
          "Accept-Language": lang,
          Accept: "application/json",
        },
      });
      if (res.ok) {
        const raw = (await res.json()) as unknown;
        if (Array.isArray(raw)) {
          const results = raw
            .map((r) => {
              const o = r as Record<string, unknown>;
              const lat = Number(o.lat);
              const lon = Number(o.lon);
              const name = typeof o.display_name === "string" ? o.display_name : "";
              if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return null;
              return { label: name, latitude: lat, longitude: lon } as Hit;
            })
            .filter((x): x is Hit => !!x);
          if (results.length > 0) return { results, error: null };
        }
      }
    } catch {
      /* fall through to Photon */
    }

    // 2) Photon (Komoot) — OSM-based, no key, friendlier rate policy
    try {
      const url = new URL("https://photon.komoot.io/api/");
      url.searchParams.set("q", data.q);
      url.searchParams.set("limit", "6");
      const res = await fetch(url.toString(), {
        headers: { "User-Agent": "CashflowApp/1.0", Accept: "application/json" },
      });
      if (!res.ok) return { results: [], error: `Search unavailable (${res.status})` };
      const json = (await res.json()) as { features?: unknown };
      const feats = Array.isArray(json.features) ? json.features : [];
      const results = feats
        .map((f) => {
          const o = f as { geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> };
          const c = o.geometry?.coordinates;
          if (!Array.isArray(c) || c.length < 2) return null;
          const lon = Number(c[0]);
          const lat = Number(c[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          const p = o.properties ?? {};
          const parts = [p.name, p.street, p.housenumber, p.postcode, p.city, p.state, p.country]
            .filter((x): x is string => typeof x === "string" && x.length > 0);
          const label = parts.join(", ");
          if (!label) return null;
          return { label, latitude: lat, longitude: lon } as Hit;
        })
        .filter((x): x is Hit => !!x);
      return { results, error: results.length === 0 ? "No results" : null };
    } catch (e) {
      return { results: [], error: e instanceof Error ? e.message : "Search unavailable" };
    }
  });