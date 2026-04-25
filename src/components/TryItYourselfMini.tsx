import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { toast } from "sonner";
import { MapPin, Locate, Loader2, Sparkles, CloudRain, Thermometer, Droplets, Layers, Crosshair, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { SATELLITE_STYLE } from "@/lib/mapStyle";
import { CROP_ICONS, CROP_LABELS, type CropType } from "@/lib/mockData";

// ---------- helpers ----------
type Pt = { lat: number; lng: number };

// Build a circular polygon (radius in meters) around a point
function circlePolygon(center: Pt, radiusM: number, steps = 48): GeoJSON.Polygon {
  const coords: [number, number][] = [];
  const R = 6378137;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const dx = (radiusM * Math.cos(a)) / (R * Math.cos((center.lat * Math.PI) / 180));
    const dy = (radiusM * Math.sin(a)) / R;
    coords.push([center.lng + (dx * 180) / Math.PI, center.lat + (dy * 180) / Math.PI]);
  }
  return { type: "Polygon", coordinates: [coords] };
}

function areaHectares(radiusM: number) {
  return (Math.PI * radiusM * radiusM) / 10000;
}

// Crop coefficients (FAO-56) — mid-season simplification
const KC_MID: Record<CropType, number> = {
  wheat: 1.15,
  corn: 1.2,
  tomatoes: 1.15,
  sunflower: 1.1,
  vineyard: 0.8,
};

// Soil texture classification from clay/sand %
function classifySoil(clayPct: number, sandPct: number) {
  const siltPct = Math.max(0, 100 - clayPct - sandPct);
  if (clayPct >= 40) return { name: "Глинеста", icon: "🟤", note: "задържа добре водата — поливай по-рядко, но обилно", awc: 0.18 };
  if (sandPct >= 70) return { name: "Песъчлива", icon: "🟡", note: "източва бързо — поливай по-често с малки дози", awc: 0.07 };
  if (clayPct >= 27 && sandPct < 45) return { name: "Глинесто-песъчлива", icon: "🟫", note: "балансирана, добра за повечето култури", awc: 0.15 };
  if (siltPct >= 50) return { name: "Тинеста", icon: "🟧", note: "висока влагоемкост, внимавай с прекомерно поливане", awc: 0.16 };
  return { name: "Песъчливо-глинеста", icon: "🟠", note: "умерена влагозадържаща способност", awc: 0.13 };
}

interface SoilData { clay: number; sand: number; }
interface WeatherData {
  temp_max_c: number;
  precip_7d_mm: number;
  et0_7d_mm: number;
  rainy_days: number;
}
interface PlaceData { label: string; }

// ---------- component ----------
export function TryItYourselfMini() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [center, setCenter] = useState<Pt | null>(null);
  const [radiusM, setRadiusM] = useState(80);
  const [crop, setCrop] = useState<CropType>("wheat");

  const [locating, setLocating] = useState(false);
  const [place, setPlace] = useState<PlaceData | null>(null);
  const [soil, setSoil] = useState<SoilData | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [analysisKey, setAnalysisKey] = useState(0);

  // init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: [25.5, 42.7],
      zoom: 6,
      maxZoom: 18,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("parcel", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "parcel-fill", type: "fill", source: "parcel", paint: { "fill-color": "#a9c7ee", "fill-opacity": 0.4 } });
      map.addLayer({ id: "parcel-line", type: "line", source: "parcel", paint: { "line-color": "#3b6fb3", "line-width": 2.5 } });
    });

    map.on("click", (e) => {
      setCenter({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    // Resize when the container changes size (e.g. section scrolled into view, layout shift)
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
  }, []);


  // update polygon on map when center/radius change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center) return;
    const apply = () => {
      const poly = circlePolygon(center, radiusM);
      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: poly }],
      };
      let src = map.getSource("parcel") as maplibregl.GeoJSONSource | undefined;
      if (!src) {
        // Source/layers weren't added yet (e.g. style still loading) — add now
        map.addSource("parcel", { type: "geojson", data });
        if (!map.getLayer("parcel-fill")) {
          map.addLayer({ id: "parcel-fill", type: "fill", source: "parcel", paint: { "fill-color": "#a9c7ee", "fill-opacity": 0.4 } });
        }
        if (!map.getLayer("parcel-line")) {
          map.addLayer({ id: "parcel-line", type: "line", source: "parcel", paint: { "line-color": "#3b6fb3", "line-width": 2.5 } });
        }
      } else {
        src.setData(data);
      }
      // Make sure the parcel is actually visible — fit to its bounds
      const coords = poly.coordinates[0] as [number, number][];
      const lons = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      map.fitBounds(
        [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: 60, duration: 800, maxZoom: 17 },
      );
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [center, radiusM]);

  // when center changes, fetch soil + weather + place
  useEffect(() => {
    if (!center) return;
    let cancelled = false;
    setLoadingData(true);
    setSoil(null);
    setWeather(null);
    setPlace(null);

    (async () => {
      try {
        const [soilRes, weatherRes, placeRes] = await Promise.allSettled([
          fetch(
            `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${center.lng}&lat=${center.lat}&property=clay&property=sand&depth=0-5cm&value=mean`
          ).then((r) => r.json()),
          fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${center.lat}&longitude=${center.lng}&daily=precipitation_sum,et0_fao_evapotranspiration,temperature_2m_max&forecast_days=7&timezone=auto`
          ).then((r) => r.json()),
          fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${center.lat}&lon=${center.lng}&format=json&zoom=10&accept-language=bg`
          ).then((r) => r.json()),
        ]);

        if (cancelled) return;

        // soil
        if (soilRes.status === "fulfilled") {
          try {
            const layers = soilRes.value?.properties?.layers ?? [];
            const clayLayer = layers.find((l: { name: string }) => l.name === "clay");
            const sandLayer = layers.find((l: { name: string }) => l.name === "sand");
            // SoilGrids returns values * 10 in g/kg ... actually clay/sand in g/kg, convert g/kg -> %
            const clayMean = clayLayer?.depths?.[0]?.values?.mean;
            const sandMean = sandLayer?.depths?.[0]?.values?.mean;
            // d_factor often 10; values stored as integers * d_factor. Use unit "g/kg" -> /10 = %
            const clayPct = typeof clayMean === "number" ? clayMean / 10 : 25;
            const sandPct = typeof sandMean === "number" ? sandMean / 10 : 40;
            setSoil({ clay: clayPct, sand: sandPct });
          } catch {
            setSoil({ clay: 25, sand: 40 });
          }
        } else {
          setSoil({ clay: 25, sand: 40 });
        }

        // weather
        if (weatherRes.status === "fulfilled" && weatherRes.value?.daily) {
          const d = weatherRes.value.daily;
          const precip: number[] = d.precipitation_sum ?? [];
          const et0: number[] = d.et0_fao_evapotranspiration ?? [];
          const tmax: number[] = d.temperature_2m_max ?? [];
          setWeather({
            temp_max_c: Math.round(Math.max(...tmax)),
            precip_7d_mm: Math.round(precip.reduce((a, b) => a + b, 0)),
            et0_7d_mm: Math.round(et0.reduce((a, b) => a + b, 0)),
            rainy_days: precip.filter((p) => p >= 1).length,
          });
        }

        // place
        if (placeRes.status === "fulfilled") {
          const a = placeRes.value?.address ?? {};
          const label = [a.village || a.town || a.city || a.county, a.state, a.country].filter(Boolean).join(", ");
          setPlace({ label: label || "Избрана локация" });
        }
      } finally {
        if (!cancelled) {
          setLoadingData(false);
          setAnalysisKey((k) => k + 1);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [center]);

  const flyTo = (pt: Pt, zoom = 14) => {
    const map = mapRef.current;
    if (!map) return;
    map.resize();
    map.flyTo({ center: [pt.lng, pt.lat], zoom, speed: 1.4 });
  };

  const detectLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Браузърът не поддържа геолокация", {
        description: "Маркирай локация ръчно, като кликнеш върху картата.",
      });
      return;
    }

    // Check if we're on a secure context (geolocation requires HTTPS)
    if (typeof window !== "undefined" && !window.isSecureContext) {
      toast.error("Геолокацията изисква защитена връзка (HTTPS)", {
        description: "Маркирай локация ръчно, като кликнеш върху картата.",
      });
      return;
    }

    setLocating(true);

    const onSuccess = (pos: GeolocationPosition) => {
      const pt = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      mapRef.current?.resize();
      setCenter(pt);
      setLocating(false);
      toast.success("Локацията е открита");
    };

    const onError = (err: GeolocationPositionError, isRetry = false) => {
      // Try again with low accuracy if high accuracy failed (common on desktop without GPS)
      if (!isRetry && (err.code === err.POSITION_UNAVAILABLE || err.code === err.TIMEOUT)) {
        navigator.geolocation.getCurrentPosition(
          onSuccess,
          (e) => onError(e, true),
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 60_000 }
        );
        return;
      }

      setLocating(false);

      let title = "Не можахме да открием локацията";
      let description = "Кликни върху картата, за да маркираш мястото ръчно.";

      switch (err.code) {
        case err.PERMISSION_DENIED:
          title = "Достъпът до локация е отказан";
          description = "Разреши достъпа в настройките на браузъра (иконата вляво от адреса) или маркирай мястото ръчно върху картата.";
          break;
        case err.POSITION_UNAVAILABLE:
          title = "Локацията не е налична";
          description = "Устройството ти няма GPS сигнал. Провери интернет връзката или маркирай мястото ръчно върху картата.";
          break;
        case err.TIMEOUT:
          title = "Изчакването изтече";
          description = "Опитай отново или маркирай мястото ръчно върху картата.";
          break;
      }

      toast.error(title, { description });
    };

    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (e) => onError(e, false),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 }
    );
  };

  // Compute irrigation recommendation
  const recommendation = (() => {
    if (!soil || !weather) return null;
    const soilCls = classifySoil(soil.clay, soil.sand);
    const kc = KC_MID[crop];
    const etc7 = weather.et0_7d_mm * kc; // crop water need 7d
    const need = Math.max(0, Math.round(etc7 - weather.precip_7d_mm));
    let status: "green" | "yellow" | "red";
    let title: string;
    if (need <= 5) {
      status = "green";
      title = "Без напояване тази седмица";
    } else if (need <= 20) {
      status = "yellow";
      title = `Полей умерено: ${need} mm`;
    } else {
      status = "red";
      title = `Спешно: ${need} mm този период`;
    }
    return { status, title, need, soilCls, etc7: Math.round(etc7) };
  })();

  return (
    <section id="try-it-yourself" className="border-y border-border bg-gradient-hero">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-card px-3 py-1 text-xs font-medium text-secondary">
            <Sparkles className="h-3.5 w-3.5" />
            Изпробвай тук — без регистрация
          </div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Персонализиран анализ за твоя терен</h2>
          <p className="mt-3 text-muted-foreground">
            Открий локацията си, маркирай площ на сателитната карта и избери култура. Системата автоматично извлича типа почва и метеоданните за теб.
          </p>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-5">
          {/* MAP */}
          <div className="lg:col-span-3">
            <div className="relative h-[420px] overflow-hidden rounded-2xl border border-border bg-card shadow-elevated sm:h-[480px]">
              <div ref={containerRef} className="absolute inset-0" />

              {/* Top controls */}
              <div className="pointer-events-auto absolute left-3 top-3 flex flex-col gap-2 rounded-xl border border-border bg-card/95 p-2 backdrop-blur-md shadow-card">
                <Button size="sm" onClick={detectLocation} disabled={locating} className="bg-primary hover:bg-primary/90">
                  {locating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Locate className="mr-1.5 h-4 w-4" />}
                  {locating ? "Откриване..." : "Моята локация"}
                </Button>
                {!center && (
                  <p className="max-w-[180px] px-1 text-[11px] text-muted-foreground">
                    Или кликни директно на картата, за да маркираш терен.
                  </p>
                )}
              </div>

              {/* Step badge */}
              <div className="pointer-events-none absolute right-3 top-3 rounded-full border border-border bg-card/95 px-3 py-1 text-xs font-semibold backdrop-blur-md">
                {!center ? "Стъпка 1 от 3 · Локация" : !crop ? "Стъпка 2 от 3 · Култура" : "Стъпка 3 от 3 · Анализ"}
              </div>

              {/* Center crosshair when no selection */}
              {!center && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="rounded-full bg-card/90 p-2 shadow-card">
                    <Crosshair className="h-6 w-6 text-secondary" />
                  </div>
                </div>
              )}

              {/* Bottom radius slider */}
              {center && (
                <div className="pointer-events-auto absolute bottom-3 left-3 right-3 rounded-xl border border-border bg-card/95 p-3 backdrop-blur-md shadow-card">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-muted-foreground">Радиус на парцела</span>
                    <span className="font-semibold text-foreground">
                      {radiusM} m · {areaHectares(radiusM).toFixed(2)} ха
                    </span>
                  </div>
                  <Slider
                    value={[radiusM]}
                    min={20}
                    max={400}
                    step={10}
                    onValueChange={([v]) => setRadiusM(v)}
                    className="mt-2"
                  />
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>20 m</span>
                    <button
                      onClick={() => { setCenter(null); setSoil(null); setWeather(null); setPlace(null); }}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 hover:bg-muted"
                    >
                      <RotateCcw className="h-3 w-3" /> Нулирай
                    </button>
                    <span>400 m</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SIDEBAR */}
          <div className="lg:col-span-2 space-y-4">
            {/* Location */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> Локация
              </div>
              {center ? (
                <div className="text-sm">
                  <div className="font-semibold">{place?.label ?? "Зарежда се..."}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {center.lat.toFixed(4)}°, {center.lng.toFixed(4)}°
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Натисни „Моята локация“ или кликни на картата.</p>
              )}
            </div>

            {/* Crop */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Култура</div>
              <div className="grid grid-cols-5 gap-1.5">
                {(Object.keys(CROP_LABELS) as CropType[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCrop(c)}
                    className={`flex flex-col items-center gap-0.5 rounded-lg border p-2 text-[11px] font-medium transition ${
                      crop === c ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
                    }`}
                    title={CROP_LABELS[c]}
                  >
                    <span className="text-lg">{CROP_ICONS[c]}</span>
                    <span className="truncate">{CROP_LABELS[c]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Soil + Weather */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Автоматичен анализ</div>
              {!center && (
                <p className="text-sm text-muted-foreground">Избери локация, за да заредим почва и метео.</p>
              )}
              {center && loadingData && (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              )}
              {center && !loadingData && soil && weather && (
                <div className="space-y-2.5 text-sm">
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-secondary" />
                      <span className="text-muted-foreground">Почва</span>
                    </div>
                    <span className="font-semibold">
                      {classifySoil(soil.clay, soil.sand).icon} {classifySoil(soil.clay, soil.sand).name}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <div className="rounded-lg border border-border bg-muted/40 px-2 py-2 text-center">
                      <Thermometer className="mx-auto h-3.5 w-3.5 text-secondary" />
                      <div className="mt-0.5 text-base font-bold">{weather.temp_max_c}°</div>
                      <div className="text-[10px] text-muted-foreground">макс. 7д</div>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 px-2 py-2 text-center">
                      <CloudRain className="mx-auto h-3.5 w-3.5 text-secondary" />
                      <div className="mt-0.5 text-base font-bold">{weather.precip_7d_mm}</div>
                      <div className="text-[10px] text-muted-foreground">mm дъжд</div>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 px-2 py-2 text-center">
                      <Droplets className="mx-auto h-3.5 w-3.5 text-secondary" />
                      <div className="mt-0.5 text-base font-bold">{weather.et0_7d_mm}</div>
                      <div className="text-[10px] text-muted-foreground">ET₀ mm</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Recommendation */}
            {recommendation && (
              <div
                key={analysisKey}
                className="animate-fade-in rounded-2xl border-2 p-4 shadow-elevated"
                style={{
                  borderColor:
                    recommendation.status === "green" ? "var(--status-green)" :
                    recommendation.status === "yellow" ? "var(--status-yellow)" : "var(--status-red)",
                  background:
                    recommendation.status === "green" ? "color-mix(in oklab, var(--status-green) 8%, var(--card))" :
                    recommendation.status === "yellow" ? "color-mix(in oklab, var(--status-yellow) 10%, var(--card))" :
                    "color-mix(in oklab, var(--status-red) 10%, var(--card))",
                }}
              >
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Препоръка за {CROP_LABELS[crop].toLowerCase()}
                </div>
                <div className="mt-1 text-lg font-bold">{recommendation.title}</div>
                <p className="mt-1.5 text-sm text-foreground/80">
                  ETc ≈ <b>{recommendation.etc7} mm</b> за 7 дни (Kc {KC_MID[crop]}). Почвата е{" "}
                  {recommendation.soilCls.name.toLowerCase()} — {recommendation.soilCls.note}.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
