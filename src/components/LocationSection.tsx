import * as React from "react";
import { ClientOnly } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { MapPin, Crosshair, Search, X, History, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { searchPlaces } from "@/utils/geocode.functions";
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

  React.useEffect(() => {
    if (value) setOpen(true);
  }, [value]);

  const capture = async () => {
    setBusy(true);
    const res = await getCurrentLocation();
    setBusy(false);
    if (res.ok) onChange(res.location);
    else setErr(res.reason);
  };
  const [err, setErr] = React.useState<string | null>(null);

  const runSearch = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const r = await doSearch({ data: { q } });
      setResults(r.results);
      setSearchErr(r.results.length === 0 ? (r.error ?? "No results") : null);
    } catch (e) {
      setResults([]);
      setSearchErr(e instanceof Error ? e.message : "Search unavailable");
    } finally {
      setSearching(false);
    }
  };

  const acc = formatAccuracy(value?.accuracy_m);

  return (
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
        {value ? (
          <>
            <ClientOnly fallback={<div className="h-40 rounded-md bg-muted" />}>
              <React.Suspense fallback={<div className="h-40 rounded-md bg-muted" />}>
                <LazyMap
                  latitude={value.latitude}
                  longitude={value.longitude}
                  accuracyM={value.accuracy_m}
                  draggable
                  onChange={(lat, lng) =>
                    onChange({
                      ...value,
                      latitude: round6(lat),
                      longitude: round6(lng),
                      accuracy_m: null,
                      source: "manual",
                    })
                  }
                  className="h-40 w-full overflow-hidden rounded-md border"
                />
              </React.Suspense>
            </ClientOnly>
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
  );
}