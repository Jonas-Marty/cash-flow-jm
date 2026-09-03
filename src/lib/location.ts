/**
 * Browser-safe location helpers shared between the transaction form, the
 * transaction list and the (lazily loaded) Leaflet map component.
 *
 * This module must never import Leaflet — the map component does that on its
 * own so the library stays out of the SSR graph.
 */

export type LocationSource = "device" | "manual" | "search";

export type TxLocation = {
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  label: string | null;
  source: LocationSource;
};

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

export function locationFromRow(row: {
  latitude?: number | string | null;
  longitude?: number | string | null;
  location_accuracy_m?: number | string | null;
  location_label?: string | null;
  location_source?: string | null;
}): TxLocation | null {
  const lat = row.latitude == null ? null : Number(row.latitude);
  const lng = row.longitude == null ? null : Number(row.longitude);
  if (lat == null || lng == null || !isValidLatLng(lat, lng)) return null;
  const acc = row.location_accuracy_m == null ? null : Number(row.location_accuracy_m);
  const src = row.location_source;
  return {
    latitude: lat,
    longitude: lng,
    accuracy_m: acc != null && Number.isFinite(acc) ? acc : null,
    label: row.location_label ?? null,
    source: src === "device" || src === "manual" || src === "search" ? src : "manual",
  };
}

/** Columns written to the `transactions` table. */
export function locationToColumns(loc: TxLocation | null) {
  return {
    latitude: loc ? round6(loc.latitude) : null,
    longitude: loc ? round6(loc.longitude) : null,
    location_accuracy_m: loc?.accuracy_m ?? null,
    location_label: loc?.label ?? null,
    location_source: loc ? loc.source : null,
  };
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function formatCoords(loc: { latitude: number; longitude: number }): string {
  return `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`;
}

/** How far away something is, in the units a person would say it in. */
export function formatDistance(m: number | null | undefined): string | null {
  if (m == null || !Number.isFinite(m)) return null;
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

export function formatAccuracy(m: number | null | undefined): string | null {
  if (m == null || !Number.isFinite(m)) return null;
  if (m >= 1000) return `±${(m / 1000).toFixed(1)} km`;
  return `±${Math.round(m)} m`;
}

export type GeoFixResult =
  | { ok: true; location: TxLocation }
  | { ok: false; reason: "unsupported" | "denied" | "unavailable" | "timeout" };

/**
 * Read a single fix from the browser. Must only be called from an event
 * handler or effect — never during render/SSR.
 */
export function getCurrentLocation(timeoutMs = 10000): Promise<GeoFixResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, reason: "unsupported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          ok: true,
          location: {
            latitude: round6(pos.coords.latitude),
            longitude: round6(pos.coords.longitude),
            accuracy_m:
              Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
            label: null,
            source: "device",
          },
        });
      },
      (err) => {
        const reason =
          err.code === err.PERMISSION_DENIED
            ? "denied"
            : err.code === err.TIMEOUT
              ? "timeout"
              : "unavailable";
        resolve({ ok: false, reason });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

export function isToday(d: Date): boolean {
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function osmLink(loc: { latitude: number; longitude: number }): string {
  return `https://www.openstreetmap.org/?mlat=${loc.latitude}&mlon=${loc.longitude}#map=17/${loc.latitude}/${loc.longitude}`;
}