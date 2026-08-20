# Transaction locations (GPS + mini map)

Store an optional location on each transaction, captured from the browser only when it makes sense, always correctable by hand, and shown as a small interactive map.

## Behaviour

- **Off by default.** A new Settings toggle "Capture location for new transactions" (per user). When off, nothing is ever requested from the browser.
- **Today only.** Auto-capture is attempted only when the transaction date equals today. Change the date to a past day and the auto-capture is skipped (an already-set location is kept, with a hint that it may not match that date).
- **Accuracy is stored, never hidden.** Any fix is kept together with its accuracy radius; the map shows the accuracy circle and a label like "±38 m" so a coarse fix is obvious. Denied/unavailable permission just leaves the field empty — no error blocking the save.
- **Manual override** (works for new and edited transactions, regardless of the toggle):
  - drag the marker on the mini map to correct the point,
  - search a place/address by name and pick a result,
  - reuse a location used before (suggested from past transactions with the same description, then most recent overall),
  - "Use my current location" button for an explicit on-demand fix,
  - clear the location entirely.
  Any manual change marks the location as user-set, so a later date change or re-render never overwrites it.
- **Where it shows.** In the add/edit form as a collapsible "Location" section with the mini map; in the transaction list a small pin chip that opens the same map preview.

## Technical notes

- Migration adds to `public.transactions`: `latitude numeric(9,6)`, `longitude numeric(9,6)`, `location_accuracy_m numeric`, `location_label text`, `location_source text` (`device` | `manual` | `search`), all nullable. Adds `capture_location boolean not null default false` to `settings`. Existing RLS/grants cover the columns; no new policies needed.
- Map component uses Leaflet + OpenStreetMap tiles, isolated in its own module loaded via `React.lazy` behind `<ClientOnly>` so the Leaflet import never enters the SSR graph. Shared types/helpers live in a separate browser-safe `src/lib/location.ts`.
- Geolocation is read in an event handler / `useEffect` only (`navigator.geolocation.getCurrentPosition` with `enableHighAccuracy`, timeout, no watch).
- Place search goes through a server function that proxies OpenStreetMap Nominatim (adds the required User-Agent, debounced, results limited), so no key is needed and the browser doesn't hit the API directly.
- "Reuse past location" is a query over the user's recent transactions with non-null coordinates, ranked by matching description first.
- Add/edit payload extends the existing insert/update in `src/routes/add.tsx`; split slices inherit the parent transaction's location.
- Version bump in `package.json`.

## Out of scope

No location-based filtering, no map view of all transactions, no reverse geocoding on every capture (only a label when picked via search or typed).
