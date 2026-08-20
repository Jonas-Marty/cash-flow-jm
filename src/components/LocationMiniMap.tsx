import * as React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Small interactive Leaflet map. Browser-only: this module is loaded lazily
 * behind <ClientOnly> so the Leaflet import never enters the SSR graph.
 */
export default function LocationMiniMap({
  latitude,
  longitude,
  accuracyM,
  draggable = false,
  onChange,
  hasValue = true,
  markers,
  onPickMarker,
  className,
}: {
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  draggable?: boolean;
  onChange?: (lat: number, lng: number) => void;
  /** When false no main marker is shown (map acts as an empty picker). */
  hasValue?: boolean;
  /** Previously used locations, shown as secondary selectable pins. */
  markers?: { latitude: number; longitude: number; label?: string | null }[];
  onPickMarker?: (m: { latitude: number; longitude: number; label?: string | null }) => void;
  className?: string;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const markerRef = React.useRef<L.Marker | null>(null);
  const circleRef = React.useRef<L.Circle | null>(null);
  const recentLayerRef = React.useRef<L.LayerGroup | null>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const onPickRef = React.useRef(onPickMarker);
  onPickRef.current = onPickMarker;

  // Bundler-safe marker: a CSS-only pin avoids Leaflet's default icon URLs.
  const icon = React.useMemo(
    () =>
      L.divIcon({
        className: "",
        html:
          '<div style="width:18px;height:18px;border-radius:9999px;background:hsl(var(--primary));border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    [],
  );

  const recentIcon = React.useMemo(
    () =>
      L.divIcon({
        className: "",
        html:
          '<div style="width:12px;height:12px;border-radius:9999px;background:#f59e0b;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:pointer"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      }),
    [],
  );

  React.useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, {
      center: [latitude, longitude],
      zoom: 16,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    const marker = L.marker([latitude, longitude], { icon, draggable }).addTo(map);
    if (!hasValue) marker.remove();
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      onChangeRef.current?.(p.lat, p.lng);
    });
    if (draggable) {
      map.on("click", (e: L.LeafletMouseEvent) => {
        onChangeRef.current?.(e.latlng.lat, e.latlng.lng);
      });
    }
    mapRef.current = map;
    markerRef.current = marker;
    recentLayerRef.current = L.layerGroup().addTo(map);
    // Leaflet needs a size recalculation once the container is laid out.
    setTimeout(() => map.invalidateSize(), 0);
    // Re-render tiles when the container resizes (e.g. expand/collapse map).
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(hostRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
      recentLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep marker/view in sync with props.
  React.useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    if (hasValue) marker.addTo(map);
    else marker.remove();
    marker.setLatLng([latitude, longitude]);
    marker.options.draggable = draggable;
    if (draggable) marker.dragging?.enable();
    else marker.dragging?.disable();
    map.setView([latitude, longitude], map.getZoom());
  }, [latitude, longitude, draggable, hasValue]);

  // Previously used locations as selectable pins.
  React.useEffect(() => {
    const layer = recentLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const m of markers ?? []) {
      const mk = L.marker([m.latitude, m.longitude], { icon: recentIcon });
      if (m.label) mk.bindTooltip(m.label, { direction: "top" });
      mk.on("click", (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onPickRef.current?.(m);
      });
      mk.addTo(layer);
    }
  }, [markers, recentIcon]);

  // Accuracy circle.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (circleRef.current) {
      circleRef.current.remove();
      circleRef.current = null;
    }
    if (hasValue && accuracyM && accuracyM > 0) {
      circleRef.current = L.circle([latitude, longitude], {
        radius: accuracyM,
        color: "#f59e0b",
        weight: 1,
        fillOpacity: 0.12,
      }).addTo(map);
    }
  }, [latitude, longitude, accuracyM, hasValue]);

  return <div ref={hostRef} className={className} style={{ minHeight: 160 }} />;
}