import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Layers, Battery, Loader2 } from "lucide-react";
import type { MockParcel } from "@/lib/mockData";
import { STATUS_COLORS } from "@/lib/mockData";
import { SATELLITE_STYLE } from "@/lib/mapStyle";
import { WaterBattery, ndmiToMoisturePct } from "@/components/WaterBattery";
import { ParcelEditor } from "@/components/ParcelEditor";
import { MapPlaceSearch } from "@/components/MapPlaceSearch";
import { toast } from "sonner";

interface ParcelMapProps {
  parcels: MockParcel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  center?: [number, number];
  zoom?: number;
  /** When set, the parcel is in edit-shape mode. */
  editingParcelId?: string | null;
  /** Live geometry/area updates while editing. */
  onEditingGeometryChange?: (geometry: GeoJSON.Polygon, areaHectares: number) => void;
  /** When > 0, the map flies to this target (lat/lon) at zoom 13. */
  flyToTarget?: { lat: number; lon: number; nonce: number } | null;
  /** When set, fly to this parcel's centroid (parcel sidebar click). */
  flyToParcelTarget?: { lat: number; lon: number; zoom: number; nonce: number } | null;
  /** Hide place search bar (e.g. while editing a polygon). */
  hidePlaceSearch?: boolean;
}

type BaseLayer = "satellite" | "street" | "ndvi";

const STREET_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

// NDVI heatmap is approximated as a darker satellite tile (placeholder for the
// real per-pixel NDVI raster which requires a Sentinel Hub WMS layer).
// Phase 2 will swap this for the real NDVI tiles.
const NDVI_STYLE: maplibregl.StyleSpecification = {
  ...SATELLITE_STYLE,
};

const STYLES: Record<BaseLayer, maplibregl.StyleSpecification> = {
  satellite: SATELLITE_STYLE,
  street: STREET_STYLE,
  ndvi: NDVI_STYLE,
};

export function ParcelMap({ parcels, selectedId, onSelect, center = [24.75, 42.15], zoom = 13, editingParcelId = null, onEditingGeometryChange, flyToTarget = null, flyToParcelTarget = null, hidePlaceSearch = false }: ParcelMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const editingRef = useRef<string | null>(editingParcelId);
  editingRef.current = editingParcelId;
  const [, forceRender] = useState(0);
  const [baseLayer, setBaseLayer] = useState<BaseLayer>("satellite");
  const [showBatteries, setShowBatteries] = useState(true);
  // Stores a parcel id requested before the map finished loading.
  const pendingSelectRef = useRef<string | null>(null);
  // Active pulse animation handle (so we can cancel when selection changes).
  const pulseRafRef = useRef<number | null>(null);
  // Trigger re-render so the ParcelEditor JSX has access to the live map ref.
  useEffect(() => {
    if (mapRef.current) forceRender((n) => n + 1);
  }, []);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLES[baseLayer],
      center,
      zoom,
      maxZoom: 18,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch base layer style — preserves camera and re-applies parcel layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(STYLES[baseLayer]);
    // Re-apply parcels after the new style finishes loading
    map.once("styledata", () => {
      const fc: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: parcels.map((p) => ({
          type: "Feature",
          geometry: p.geometry,
          properties: {
            id: p.id,
            color: STATUS_COLORS[p.status].fill,
            selected: p.id === selectedId ? 1 : 0,
            ndmi: p.ndmi,
          },
        })),
      };
      if (!map.getSource("parcels")) {
        map.addSource("parcels", { type: "geojson", data: fc });
      } else {
        (map.getSource("parcels") as maplibregl.GeoJSONSource).setData(fc);
      }
      if (!map.getLayer("parcels-fill")) {
        map.addLayer({
          id: "parcels-fill",
          type: "fill",
          source: "parcels",
          paint: {
            // NDVI overlay: tint by NDMI value when in NDVI mode
            "fill-color": baseLayer === "ndvi"
              ? [
                  "interpolate", ["linear"], ["get", "ndmi"],
                  -0.3, "#7f1d1d",
                  -0.1, "#dc2626",
                  0.1, "#eab308",
                  0.3, "#16a34a",
                  0.5, "#064e3b",
                ]
              : ["get", "color"],
            "fill-opacity": baseLayer === "ndvi"
              ? ["case", ["==", ["get", "selected"], 1], 0.0, 0.25]
              : ["case", ["==", ["get", "selected"], 1], 0.5, 0.2],
          },
        });
        map.addLayer({
          id: "parcels-outline",
          type: "line",
          source: "parcels",
          paint: {
            "line-color": ["case", ["==", ["get", "selected"], 1], "#ffffff", baseLayer === "ndvi" ? "#0f172a" : ["get", "color"]],
            "line-width": ["case", ["==", ["get", "selected"], 1], 3, 2.5],
            "line-opacity": ["case", ["==", ["get", "selected"], 1], 1, 0.4],
          },
        });
        map.on("click", "parcels-fill", (e) => {
          if (editingRef.current) return; // Block selection while editing.
          const f = e.features?.[0];
          if (f?.properties?.id) onSelectRef.current(f.properties.id as string);
        });
        map.on("mouseenter", "parcels-fill", () => {
          if (!editingRef.current) map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "parcels-fill", () => (map.getCanvas().style.cursor = ""));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseLayer]);

  // Update parcels layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const fc: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: parcels
          // Hide the original polygon while we are editing it; ParcelEditor
          // renders its own (orange) outline on top.
          .filter((p) => p.id !== editingParcelId)
          .map((p) => ({
            type: "Feature",
            geometry: p.geometry,
            properties: {
              id: p.id,
              name: p.name,
              color: STATUS_COLORS[p.status].fill,
              selected: p.id === selectedId ? 1 : 0,
              ndmi: p.ndmi,
            },
          })),
      };

      const src = map.getSource("parcels") as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(fc);
      } else {
        map.addSource("parcels", { type: "geojson", data: fc });
        map.addLayer({
          id: "parcels-fill",
          type: "fill",
          source: "parcels",
          paint: {
            "fill-color": baseLayer === "ndvi"
              ? [
                  "interpolate", ["linear"], ["get", "ndmi"],
                  -0.3, "#7f1d1d",
                  -0.1, "#dc2626",
                  0.1, "#eab308",
                  0.3, "#16a34a",
                  0.5, "#064e3b",
                ]
              : ["get", "color"],
            "fill-opacity": baseLayer === "ndvi"
              ? ["case", ["==", ["get", "selected"], 1], 0.0, 0.25]
              : ["case", ["==", ["get", "selected"], 1], 0.5, 0.2],
          },
        });
        map.addLayer({
          id: "parcels-outline",
          type: "line",
          source: "parcels",
          paint: {
            "line-color": ["case", ["==", ["get", "selected"], 1], "#ffffff", baseLayer === "ndvi" ? "#0f172a" : ["get", "color"]],
            "line-width": ["case", ["==", ["get", "selected"], 1], 3, 2.5],
            "line-opacity": ["case", ["==", ["get", "selected"], 1], 1, 0.4],
          },
        });

        map.on("click", "parcels-fill", (e) => {
          if (editingRef.current) return; // Block selection while editing.
          const f = e.features?.[0];
          if (f?.properties?.id) onSelectRef.current(f.properties.id as string);
        });
        map.on("mouseenter", "parcels-fill", () => {
          if (!editingRef.current) map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "parcels-fill", () => (map.getCanvas().style.cursor = ""));
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [parcels, selectedId, baseLayer, editingParcelId]);

  // Fly to selected parcel — fits the parcel bbox with right-padding so
  // the geometry is centered in the visible area (not hidden behind the
  // detail side panel). Also animates a 2-second pulse on the outline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const parcel = parcels.find((p) => p.id === selectedId);
    const ring = parcel?.geometry?.coordinates?.[0] as [number, number][] | undefined;
    if (!ring || ring.length < 3) {
      // No drawn boundary — remember the request but don't move the map.
      pendingSelectRef.current = null;
      return;
    }

    // Compute bbox.
    let minLon = ring[0][0], maxLon = ring[0][0];
    let minLat = ring[0][1], maxLat = ring[0][1];
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    // Approx span in km (1° lat ≈ 111 km).
    const spanKm = Math.max(
      (maxLat - minLat) * 111,
      (maxLon - minLon) * 111 * Math.cos((minLat + maxLat) / 2 * Math.PI / 180),
    );
    const maxZoom = spanKm > 50 ? 10 : 17;

    const fitAndPulse = () => {
      // Adapt padding to canvas size — MapLibre throws / silently fails if
      // padding consumes more than the available width or height.
      const canvas = map.getCanvas();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      // Detail panel is max-w-[400px]; reserve right space only when there's room.
      const rightPad = w > 900 ? 420 : w > 700 ? 280 : 20;
      const sidePad = w > 700 ? 60 : 20;
      const vertPad = h > 500 ? 80 : 30;
      const padding = { top: vertPad, bottom: vertPad, left: sidePad, right: rightPad };
      console.log("[map.fitBounds] parcel click", {
        parcelId: selectedId,
        parcelName: parcel?.name,
        bbox: [minLon, minLat, maxLon, maxLat],
        spanKm,
        maxZoom,
        canvas: { w, h },
        padding,
      });
      try {
        map.fitBounds(
          [[minLon, minLat], [maxLon, maxLat]],
          { padding, duration: 900, maxZoom, essential: true },
        );
      } catch (err) {
        // Fallback to flyTo on the centroid if fitBounds rejects the padding.
        console.warn("[map.fitBounds] failed, falling back to flyTo", err);
        const cx = (minLon + maxLon) / 2;
        const cy = (minLat + maxLat) / 2;
        map.flyTo({ center: [cx, cy], zoom: Math.min(16, maxZoom), duration: 900, essential: true });
      }

      // Pulse the outline of the selected parcel for 2s.
      if (pulseRafRef.current != null) cancelAnimationFrame(pulseRafRef.current);
      const start = performance.now();
      const DURATION = 2000;
      const tick = (now: number) => {
        const t = (now - start) / DURATION;
        if (!map.getLayer("parcels-outline")) return;
        if (t >= 1) {
          // End of pulse: restore default (selected = 3).
          map.setPaintProperty("parcels-outline", "line-width", [
            "case", ["==", ["get", "selected"], 1], 3, 2.5,
          ]);
          pulseRafRef.current = null;
          return;
        }
        // 3 → 7 → 3 with two cycles.
        const wave = Math.abs(Math.sin(t * Math.PI * 2));
        const pulseW = 3 + wave * 4;
        map.setPaintProperty("parcels-outline", "line-width", [
          "case", ["==", ["get", "selected"], 1], pulseW, 2.5,
        ]);
        pulseRafRef.current = requestAnimationFrame(tick);
      };
      pulseRafRef.current = requestAnimationFrame(tick);
    };

    if (map.isStyleLoaded()) fitAndPulse();
    else {
      pendingSelectRef.current = selectedId;
      map.once("load", () => {
        if (pendingSelectRef.current === selectedId) {
          pendingSelectRef.current = null;
          fitAndPulse();
        }
      });
    }

    return () => {
      if (pulseRafRef.current != null) {
        cancelAnimationFrame(pulseRafRef.current);
        pulseRafRef.current = null;
      }
    };
  }, [selectedId, parcels, editingParcelId]);

  // External fly-to (e.g. from MapPlaceSearch) — uses flyTo with smooth curve.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToTarget) return;
    const fly = () => {
      console.log("[map.flyTo] external (search bar)", {
        lon: flyToTarget.lon,
        lat: flyToTarget.lat,
        nonce: flyToTarget.nonce,
      });
      map.flyTo({
        center: [flyToTarget.lon, flyToTarget.lat],
        zoom: 13,
        speed: 1.5,
        curve: 1.4,
        essential: true,
      });
    };
    if (map.isStyleLoaded()) fly();
    else map.once("load", fly);
  }, [flyToTarget?.nonce, flyToTarget?.lat, flyToTarget?.lon]);

  // Fly-to specific parcel — uses the same flyTo mechanism as the city
  // search so the camera smoothly travels to the parcel centroid.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToParcelTarget) return;
    const fly = () => {
      console.log("[map.flyTo] parcel sidebar click", {
        lon: flyToParcelTarget.lon,
        lat: flyToParcelTarget.lat,
        zoom: flyToParcelTarget.zoom,
        nonce: flyToParcelTarget.nonce,
      });
      map.flyTo({
        center: [flyToParcelTarget.lon, flyToParcelTarget.lat],
        zoom: flyToParcelTarget.zoom,
        speed: 1.5,
        curve: 1.4,
        essential: true,
      });
    };
    if (map.isStyleLoaded()) fly();
    else map.once("load", fly);
  }, [flyToParcelTarget?.nonce, flyToParcelTarget?.lat, flyToParcelTarget?.lon, flyToParcelTarget?.zoom]);


  // --- NDMI per-parcel heatmap (Sentinel-2 raster, 10m/pixel) ---
  // Fetches the moisture raster for the selected parcel and overlays it
  // on the map as an image source clipped to the polygon bbox.
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const heatmapCacheRef = useRef<Map<string, { image: string; bbox: [number, number, number, number] }>>(new Map());

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const HEATMAP_SOURCE = "ndmi-heatmap";
    const HEATMAP_LAYER = "ndmi-heatmap-layer";

    const cleanup = () => {
      if (map.getLayer(HEATMAP_LAYER)) map.removeLayer(HEATMAP_LAYER);
      if (map.getSource(HEATMAP_SOURCE)) map.removeSource(HEATMAP_SOURCE);
    };

    // Only show heatmap in NDVI mode with a selected parcel.
    if (baseLayer !== "ndvi" || !selectedId) {
      const tryCleanup = () => cleanup();
      if (map.isStyleLoaded()) tryCleanup();
      else map.once("styledata", tryCleanup);
      return;
    }

    let cancelled = false;

    const apply = async () => {
      // Cache hit?
      const cached = heatmapCacheRef.current.get(selectedId);
      const place = (image: string, bbox: [number, number, number, number]) => {
        if (cancelled) return;
        cleanup();
        const [minLon, minLat, maxLon, maxLat] = bbox;
        map.addSource(HEATMAP_SOURCE, {
          type: "image",
          url: image,
          coordinates: [
            [minLon, maxLat],
            [maxLon, maxLat],
            [maxLon, minLat],
            [minLon, minLat],
          ],
        });
        map.addLayer({
          id: HEATMAP_LAYER,
          type: "raster",
          source: HEATMAP_SOURCE,
          paint: { "raster-opacity": 0.85, "raster-resampling": "nearest" },
        });
        // Make sure the parcel outline stays on top of the heatmap.
        if (map.getLayer("parcels-outline")) {
          map.moveLayer("parcels-outline");
        }
      };

      if (cached) {
        place(cached.image, cached.bbox);
        return;
      }

      setHeatmapLoading(true);
      try {
        const resp = await fetch("/api/parcel-moisture-raster", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parcel_id: selectedId }),
        });
        const json = await resp.json();
        if (!resp.ok) throw new Error(json?.error ?? "Грешка при зареждане на NDMI карта");
        const bbox = json.bbox as [number, number, number, number];
        heatmapCacheRef.current.set(selectedId, { image: json.image, bbox });
        place(json.image, bbox);
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "NDMI карта недостъпна");
        }
      } finally {
        if (!cancelled) setHeatmapLoading(false);
      }
    };

    if (map.isStyleLoaded()) void apply();
    else map.once("styledata", () => void apply());

    return () => {
      cancelled = true;
      const map2 = mapRef.current;
      if (map2 && map2.isStyleLoaded()) cleanup();
    };
  }, [baseLayer, selectedId]);

  // --- Battery markers (HTML overlays, not in the GL canvas) ---
  // We render one battery per parcel anchored at its centroid using maplibre Markers.
  const markersRef = useRef<maplibregl.Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (!showBatteries) return;

    parcels.forEach((p) => {
      const ring = p.geometry?.coordinates?.[0] as [number, number][] | undefined;
      if (!ring || ring.length < 3) return;
      const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
      const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
      const pct = ndmiToMoisturePct(p.ndmi);

      const el = document.createElement("div");
      el.style.cursor = "pointer";
      el.style.pointerEvents = "auto";
      el.title = `${p.name}: ${pct}% влага`;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current(p.id);
      });

      // Render a simple inline battery (no React tree per marker for perf).
      const zone =
        pct >= 70 ? "#16a34a" :
        pct >= 50 ? "#eab308" :
        pct > 5 ? "#dc2626" : "#7f1d1d";
      el.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4));">
          <div style="width:10px;height:3px;background:rgba(255,255,255,.85);border-radius:2px;margin-bottom:1px;"></div>
          <div style="position:relative;width:18px;height:36px;border:2px solid rgba(255,255,255,.85);border-radius:4px;background:rgba(15,23,42,.55);overflow:hidden;">
            <div style="position:absolute;left:0;right:0;bottom:0;height:${pct}%;background:${zone};transition:height .4s;"></div>
          </div>
          <div style="margin-top:2px;font-size:10px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.7);">${pct}%</div>
        </div>
      `;

      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([cx, cy])
        .addTo(map);
      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [parcels, showBatteries]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* Place search (Nominatim, BG only) — map navigation */}
      {!hidePlaceSearch && (
        <div className="absolute left-3 top-14 z-10">
          <MapPlaceSearch
            onSelect={(lat, lon) => {
              const map = mapRef.current;
              if (!map) return;
              map.flyTo({ center: [lon, lat], zoom: 13, speed: 1.5, curve: 1.4, essential: true });
            }}
          />
        </div>
      )}

      <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-xl border border-border bg-card/95 p-1 shadow-elevated backdrop-blur">
        <Layers className="ml-1.5 h-3.5 w-3.5 text-muted-foreground" />
        {([
          { key: "satellite", label: "Сателит" },
          { key: "street", label: "Карта" },
          { key: "ndvi", label: "NDVI" },
        ] as { key: BaseLayer; label: string }[]).map((opt) => (
          <button
            key={opt.key}
            onClick={() => setBaseLayer(opt.key)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              baseLayer === opt.key
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-muted"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <div className="mx-1 h-4 w-px bg-border" />
        <button
          onClick={() => setShowBatteries((v) => !v)}
          title="Показвай водни батерии"
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${
            showBatteries ? "bg-secondary text-secondary-foreground" : "text-foreground hover:bg-muted"
          }`}
        >
          <Battery className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* NDVI heatmap loading indicator */}
      {baseLayer === "ndvi" && heatmapLoading && (
        <div className="absolute right-3 top-16 z-10 flex items-center gap-2 rounded-xl border border-border bg-card/95 px-3 py-2 text-xs shadow-elevated backdrop-blur">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>Зареждам NDVI карта…</span>
        </div>
      )}

      {/* NDVI legend (matches the per-pixel raster ramp from the server evalscript) */}
      {baseLayer === "ndvi" && (
        <div className="absolute bottom-12 left-3 z-10 rounded-xl border border-border bg-card/95 p-3 text-xs shadow-elevated backdrop-blur">
          <div className="mb-1.5 font-semibold">NDVI · вегетация в парцела</div>
          <div className="flex items-center gap-2">
            <div
              className="h-3 w-40 rounded"
              style={{ background: "linear-gradient(90deg,#a52a2a,#dc2626,#eab308,#16a34a,#14532d)" }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>Лошо</span><span>Нормално</span><span>Добро</span>
          </div>
          {!selectedId && (
            <div className="mt-2 text-[10px] text-muted-foreground">
              Избери парцел за per-pixel NDVI карта (10 м/пиксел, NIR + Red от Sentinel-2)
            </div>
          )}
        </div>
      )}

      {/* Edit-mode badge */}
      {editingParcelId && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 shadow-elevated">
          ✏️ Режим редактиране · влачи ъглите · кликни в средата за нов · двойно кликване изтрива
        </div>
      )}

      {/* Vertex editor (mounts on top of MapLibre when editing) */}
      {editingParcelId && (() => {
        const target = parcels.find((p) => p.id === editingParcelId);
        if (!target || !mapRef.current) return null;
        return (
          <ParcelEditor
            map={mapRef.current}
            geometry={target.geometry}
            onChange={(g, ha) => onEditingGeometryChange?.(g, ha)}
          />
        );
      })()}

      {/* Suppress unused-import warning for WaterBattery (kept for future inline use) */}
      {false && <WaterBattery moisturePct={0} />}
    </div>
  );
}
