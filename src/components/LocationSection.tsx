import * as React from "react";
import { ClientOnly } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { MapPin, Crosshair, Search, X, History, ExternalLink, Maximize2, Minimize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { searchPlaces, reverseGeocode } from "@/utils/geocode.functions";
import {
  formatAccuracy,
  formatCoords,
  getCurrentLocation,
  osmLink,
  round6,
  type TxLocation,
} from "@/lib/location";

const LazyMap = React.lazy(() => import("@/components/LocationMiniMap"));

export type RecentLocation = TxLocation & { description: string | null };

export function LocationSection({
  value,
  onChange,
  dateIsToday,
  recent,
  className,
}: {
  value: TxLocation | null;
  onChange: (loc: TxLocation | null) => void;
  dateIsToday: boolean;
  recent?: RecentLocation[];
  className?: string;
}) {
  const { t: tr } = useI18n();
  const [open, setOpen] = React.useState(!!value);
  const [busy, setBusy] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<{ label: string; latitude: number; longitude: number }[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [searchErr, setSearchErr] = React.useState<string | null>(null);
  const [showRecent, setShowRecent] = React.useState(false);
  const doSearch = useServerFn(searchPlaces);
  const doReverse = useServerFn(reverseGeocode);
  const [resolving, setResolving] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const reverseSeq = React.useRef(0);

  /**
   * A hand-placed point must never keep the address of the previous pick —
   * drop the label immediately, then ask OSM for the address at the new spot.
   */
  const setManualPoint = React.useCallback(
    (lat: number, lng: number) => {
      const latitude = round6(lat);
      const longitude = round6(lng);
      onChange({ latitude, longitude, accuracy_m: null, label: null, source: "manual" });
      const seq = ++reverseSeq.current;
      setResolving(true);
      void doReverse({ data: { latitude, longitude } })
        .then((r) => {
          if (seq !== reverseSeq.current) return;
          if (r.label) {
            onChange({ latitude, longitude, accuracy_m: null, label: r.label, source: "manual" });
          }
        })
        .catch(() => {})
        .finally(() => {
          if (seq === reverseSeq.current) setResolving(false);
        });
    },
    [doReverse, onChange],
  );

  React.useEffect(() => {
    if (value) setOpen(true);
  }, [value]);

  const capture = async () => {
    setBusy(true);
    const res = await getCurrentLocation();
    setBusy(false);
    if (res.ok) {
      onChange(res.location);
      const seq = ++reverseSeq.current;
      setResolving(true);
      try {
        const r = await doReverse({
          data: { latitude: res.location.latitude, longitude: res.location.longitude },
        });
        if (seq === reverseSeq.current && r.label) onChange({ ...res.location, label: r.label });
      } catch {
        /* label stays empty */
      } finally {
        if (seq === reverseSeq.current) setResolving(false);
      }
    } else setErr(res.reason);
  };
  const [err, setErr] = React.useState<string | null>(null);

  const searchSeq = React.useRef(0);
  const lastQueryRef = React.useRef("");

  const runSearch = React.useCallback(async (raw?: string) => {
    const q = (raw ?? query).trim();
    if (q.length < 2) {
      setResults([]);
      setSearchErr(null);
      return;
    }
    lastQueryRef.current = q;
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const r = await doSearch({ data: { q } });
      if (seq !== searchSeq.current) return;
      setResults(r.results);
      setSearchErr(r.results.length === 0 ? (r.error ?? "No results") : null);
    } catch (e) {
      if (seq !== searchSeq.current) return;
      setResults([]);
      setSearchErr(e instanceof Error ? e.message : "Search unavailable");
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doSearch, query]);

  // Search-as-you-type, debounced so we stay well inside the OSM usage policy.
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 3 || q === lastQueryRef.current) return;
    const id = setTimeout(() => void runSearch(q), 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const acc = formatAccuracy(value?.accuracy_m);

  const renderMap = (mapClass: string) => (
    <ClientOnly fallback={<div className={cn("rounded-md bg-muted", mapClass)} />}>
      <React.Suspense fallback={<div className={cn("rounded-md bg-muted", mapClass)} />}>
        <LazyMap
          latitude={value?.latitude ?? recent?.[0]?.latitude ?? 47.3769}
          longitude={value?.longitude ?? recent?.[0]?.longitude ?? 8.5417}
          accuracyM={value?.accuracy_m}
          hasValue={!!value}
          draggable
          markers={(recent ?? []).map((r) => ({
            latitude: r.latitude,
            longitude: r.longitude,
            label: r.label ?? r.description ?? null,
          }))}
          onPickMarker={(m) =>
            onChange({
              latitude: m.latitude,
              longitude: m.longitude,
              accuracy_m: null,
              label: m.label ?? null,
              source: "manual",
            })
          }
          onChange={setManualPoint}
          className={cn("w-full overflow-hidden rounded-md border", mapClass)}
        />
      </React.Suspense>
    </ClientOnly>
  );

  return (
    <>
    <Collapsible open={open} onOpenChange={setOpen} className={cn("rounded-lg border", className)}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          {tr("loc.title")}
          {value ? (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {value.label ?? formatCoords(value)}
            </span>
          ) : (
            <span className="text-xs font-normal text-muted-foreground">{tr("loc.none")}</span>
          )}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t px-3 py-3">
        <div className="flex items-center justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setExpanded(true)}
            aria-label={tr("loc.expand_map")}
          >
            <Maximize2 className="mr-1.5 h-4 w-4" />
            {tr("loc.expand_map")}
          </Button>
        </div>
        {expanded ? (
          <div className="grid h-48 w-full place-items-center rounded-md border bg-muted text-xs text-muted-foreground">
            {tr("loc.map_in_overlay")}
          </div>
        ) : (
          renderMap("h-48")
        )}
        {value ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{formatCoords(value)}</span>
              {acc ? (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">
                  {acc}
                </span>
              ) : null}
              <span>{tr(`loc.source.${value.source}`)}</span>
              <a
                href={osmLink(value)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 underline"
              >
                <ExternalLink className="h-3 w-3" /> OSM
              </a>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{tr("loc.address_label")}</Label>
              <div className="relative">
                <Input
                  value={value.label ?? ""}
                  onChange={(e) => onChange({ ...value, label: e.target.value || null })}
                  placeholder={resolving ? tr("loc.resolving") : tr("loc.address_ph")}
                  className="pr-9"
                />
                {value.label ? (
                  <button
                    type="button"
                    onClick={() => onChange({ ...value, label: null })}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={tr("loc.clear_label")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              {resolving ? <p className="text-xs text-muted-foreground">{tr("loc.resolving")}</p> : null}
            </div>
            <p className="text-xs text-muted-foreground">{tr("loc.drag_hint")}</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {dateIsToday ? tr("loc.empty_hint") : tr("loc.empty_hint_past")}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={capture} disabled={busy}>
            <Crosshair className="mr-1 h-4 w-4" />
            {busy ? tr("loc.locating") : tr("loc.use_current")}
          </Button>
          {recent && recent.length > 0 ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setShowRecent((v) => !v)}>
              <History className="mr-1 h-4 w-4" />
              {tr("loc.reuse")}
            </Button>
          ) : null}
          {value ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
              <X className="mr-1 h-4 w-4" />
              {tr("loc.clear")}
            </Button>
          ) : null}
        </div>
        {err ? <p className="text-xs text-destructive">{tr(`loc.error.${err}`)}</p> : null}

        {showRecent && recent && recent.length > 0 ? (
          <div className="max-h-40 space-y-1 overflow-auto rounded-md border p-1">
            {recent.map((r, i) => (
              <button
                key={`${r.latitude}-${r.longitude}-${i}`}
                type="button"
                className="flex w-full flex-col items-start rounded px-2 py-1 text-left text-xs hover:bg-accent"
                onClick={() => {
                  onChange({
                    latitude: r.latitude,
                    longitude: r.longitude,
                    accuracy_m: null,
                    label: r.label,
                    source: "manual",
                  });
                  setShowRecent(false);
                }}
              >
                <span className="font-medium">{r.label ?? r.description ?? formatCoords(r)}</span>
                <span className="text-muted-foreground">{formatCoords(r)}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="space-y-1">
          <Label className="text-xs">{tr("loc.search_label")}</Label>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runSearch();
                }
              }}
              placeholder={tr("loc.search_ph")}
            />
            <Button type="button" size="sm" variant="outline" onClick={() => void runSearch()} disabled={searching}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
          {searchErr ? <p className="text-xs text-destructive">{searchErr}</p> : null}
          {results.length > 0 ? (
            <div className="max-h-40 space-y-1 overflow-auto rounded-md border p-1">
              {results.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  className="w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    onChange({
                      latitude: round6(r.latitude),
                      longitude: round6(r.longitude),
                      accuracy_m: null,
                      label: r.label,
                      source: "search",
                    });
                    setResults([]);
                    setQuery("");
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>

    <Dialog open={expanded} onOpenChange={setExpanded}>
      <DialogContent
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-3 rounded-none p-3 sm:h-[calc(100vh-4rem)] sm:w-[calc(100vw-4rem)] sm:rounded-lg sm:p-4"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" /> {tr("loc.title")}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1">{expanded ? renderMap("h-full") : null}</div>
        <div className="shrink-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={capture} disabled={busy}>
              <Crosshair className="mr-1 h-4 w-4" />
              {busy ? tr("loc.locating") : tr("loc.use_current")}
            </Button>
            {value ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
                <X className="mr-1 h-4 w-4" />
                {tr("loc.clear")}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="ml-auto"
              onClick={() => setExpanded(false)}
            >
              <Minimize2 className="mr-1.5 h-4 w-4" />
              {tr("loc.collapse_map")}
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="relative">
              <Input
                value={value?.label ?? ""}
                disabled={!value}
                onChange={(e) => value && onChange({ ...value, label: e.target.value || null })}
                placeholder={resolving ? tr("loc.resolving") : tr("loc.address_ph")}
                className="pr-9"
              />
              {value?.label ? (
                <button
                  type="button"
                  onClick={() => onChange({ ...value, label: null })}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={tr("loc.clear_label")}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runSearch();
                  }
                }}
                placeholder={tr("loc.search_ph")}
              />
              <Button type="button" size="sm" variant="outline" onClick={() => void runSearch()} disabled={searching}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {results.length > 0 ? (
            <div className="max-h-28 space-y-1 overflow-auto rounded-md border p-1">
              {results.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  className="w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    onChange({
                      latitude: round6(r.latitude),
                      longitude: round6(r.longitude),
                      accuracy_m: null,
                      label: r.label,
                      source: "search",
                    });
                    setResults([]);
                    setQuery("");
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          ) : null}
          {searchErr ? <p className="text-xs text-destructive">{searchErr}</p> : null}
          <p className="text-xs text-muted-foreground">
            {value ? formatCoords(value) : tr("loc.empty_hint")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}