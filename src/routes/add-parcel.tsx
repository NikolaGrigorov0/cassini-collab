import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import maplibregl from "maplibre-gl";
import { ArrowLeft, ArrowRight, Pencil, Trash2, Check, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Logo } from "@/components/Logo";
import { ParcelImport } from "@/components/ParcelImport";
import { LocationSearchBar } from "@/components/LocationSearchBar";
import type { PlaceResult } from "@/hooks/useLocationSearch";
import { CROP_ICONS, CROP_LABELS, PHASE_LABELS, type CropType, type GrowthPhase } from "@/lib/mockData";
import { SATELLITE_STYLE } from "@/lib/mapStyle";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/add-parcel")({
  head: () => ({
    meta: [
      { title: "Добави парцел — AquaDose" },
      { name: "description", content: "Начертай ново поле и получи препоръки за напояване." },
    ],
  }),
  component: AddParcel,
});

// Spherical polygon area in m^2 -> hectares (lng/lat order, ring closed or not)
function polygonAreaHectares(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  const R = 6378137;
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    area += ((lng2 - lng1) * Math.PI / 180) * (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
  }
  area = Math.abs(area * R * R / 2);
  return area / 10000;
}

function AddParcel() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [polygon, setPolygon] = useState<[number, number][]>([]);
  const area = polygonAreaHectares(polygon);

  const [name, setName] = useState("");
  const [crop, setCrop] = useState<CropType>("wheat");
  const [phase, setPhase] = useState<GrowthPhase>("development");
  const [pumpFlow, setPumpFlow] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawingRef = useRef(false);
  const pointsRef = useRef<[number, number][]>([]);
  const [drawing, setDrawing] = useState(false);
  const [searchedPlace, setSearchedPlace] = useState<{ name: string; lat: number; lon: number } | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  // Init map (only on step 1)
  useEffect(() => {
    if (step !== 1 || !containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: [25.5, 42.7],
      zoom: 7,
      maxZoom: 18,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    mapRef.current = map;

    const updateLayer = () => {
      const ring = pointsRef.current;
      const closed = ring.length >= 3 ? [...ring, ring[0]] : ring;
      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: ring.length === 0 ? [] : [{
          type: "Feature",
          properties: {},
          geometry: ring.length >= 3
            ? { type: "Polygon", coordinates: [closed] }
            : { type: "LineString", coordinates: ring },
        }],
      };
      const src = map.getSource("draw") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(data);
    };

    map.on("load", () => {
      map.addSource("draw", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "draw-fill", type: "fill", source: "draw", paint: { "fill-color": "#a9c7ee", "fill-opacity": 0.4 }, filter: ["==", "$type", "Polygon"] });
      map.addLayer({ id: "draw-line", type: "line", source: "draw", paint: { "line-color": "#a9c7ee", "line-width": 3, "line-dasharray": [2, 2] } });
    });

    map.on("click", (e) => {
      if (!drawingRef.current) return;
      pointsRef.current = [...pointsRef.current, [e.lngLat.lng, e.lngLat.lat]];
      updateLayer();
      // Hide pulsing marker + banner once user starts drawing
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
      setSearchedPlace(null);
    });
    map.on("dblclick", (e) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      drawingRef.current = false;
      setDrawing(false);
      setPolygon([...pointsRef.current]);
      map.getCanvas().style.cursor = "";
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [step]);

  const handlePlaceSelect = (place: PlaceResult) => {
    const map = mapRef.current;
    if (!map) return;
    console.log("[map.flyTo] add-parcel search bar", {
      primary: place.primary,
      secondary: place.secondary,
      lon: place.lon,
      lat: place.lat,
    });
    map.flyTo({ center: [place.lon, place.lat], zoom: 13, duration: 1000, essential: true });
    setSearchedPlace({ name: place.primary, lat: place.lat, lon: place.lon });

    // Remove any existing marker
    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }

    // Add pulsing green marker after fly animation
    setTimeout(() => {
      if (!mapRef.current) return;
      const el = document.createElement("div");
      el.className = "aqua-pulse-marker";
      el.innerHTML = `
        <span class="aqua-pulse-ring"></span>
        <span class="aqua-pulse-dot"></span>
      `;
      const m = new maplibregl.Marker({ element: el })
        .setLngLat([place.lon, place.lat])
        .addTo(mapRef.current);
      markerRef.current = m;
    }, 1000);
  };

  const startDrawing = () => {
    pointsRef.current = [];
    setPolygon([]);
    drawingRef.current = true;
    setDrawing(true);
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = "crosshair";
      const src = mapRef.current.getSource("draw") as maplibregl.GeoJSONSource | undefined;
      src?.setData({ type: "FeatureCollection", features: [] });
      mapRef.current.doubleClickZoom.disable();
    }
  };

  const clearDrawing = () => {
    pointsRef.current = [];
    setPolygon([]);
    drawingRef.current = false;
    setDrawing(false);
    const src = mapRef.current?.getSource("draw") as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: [] });
    mapRef.current?.doubleClickZoom.enable();
  };

  // Apply an imported polygon to the map and state
  const applyImportedPolygon = (ring: [number, number][]) => {
    pointsRef.current = ring.slice(0, -1); // strip closing point
    setPolygon(pointsRef.current);
    drawingRef.current = false;
    setDrawing(false);
    const map = mapRef.current;
    if (!map) return;
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }],
    };
    const src = map.getSource("draw") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(data);
    // Fit map to imported polygon
    const lons = ring.map((c) => c[0]);
    const lats = ring.map((c) => c[1]);
    map.fitBounds(
      [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: 80, duration: 800, maxZoom: 16 },
    );
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Въведи име на парцела"); return; }
    if (polygon.length < 3) { toast.error("Начертай парцел"); return; }
    setSaving(true);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setSaving(false);
      toast.error("Моля влез в акаунта си");
      navigate({ to: "/auth" });
      return;
    }

    const ring = [...polygon, polygon[0]];
    const geometry: GeoJSON.Polygon = { type: "Polygon", coordinates: [ring] };
    const { error } = await supabase.from("parcels").insert({
      user_id: userData.user.id,
      name: name.trim(),
      crop_type: crop,
      growth_phase: phase,
      area_hectares: Number(area.toFixed(2)),
      geometry: JSON.stringify(geometry),
      pump_flow_m3h: pumpFlow.trim() ? Number(pumpFlow) : null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Парцелът е запазен");
    navigate({ to: "/dashboard" });
  };

  const firstAnalysis = new Date(Date.now() + 5 * 86400000).toLocaleDateString("bg-BG", { day: "numeric", month: "long" });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-3">
          <Link to="/dashboard"><Button variant="ghost" size="icon" aria-label="Назад"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <Logo />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${step >= 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>1</span>
          <div className={`h-0.5 w-8 sm:w-12 ${step >= 2 ? "bg-primary" : "bg-border"}`} />
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${step >= 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>2</span>
          <span className="ml-2 hidden text-muted-foreground sm:inline">Стъпка {step} от 2</span>
        </div>
        <div className="w-20" />
      </header>

      {step === 1 ? (
        <div className="relative flex flex-1 overflow-hidden">
          <div ref={containerRef} className="h-full w-full" />

          <LocationSearchBar onSelect={handlePlaceSelect} />

          {searchedPlace && (
            <div className="absolute left-4 top-[68px] z-10 w-[300px] max-w-[calc(100vw-2rem)] rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 shadow-lg">
              📍 <span className="font-semibold">{searchedPlace.name}</span> — Намери парцела и нарисувай границите му
            </div>
          )}

          {/* Toolbar */}
          <div className="absolute left-4 top-[120px] z-10 flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 shadow-elevated max-w-[calc(100vw-2rem)]">
            <div className="text-sm font-semibold">Стъпка 1: Начертай парцела</div>
            <p className="text-xs text-muted-foreground">Кликни за вертекси, двоен клик за край.</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={startDrawing} disabled={drawing} className="bg-primary hover:bg-primary/90">
                <Pencil className="mr-1.5 h-4 w-4" />
                {drawing ? "Чертая..." : "Начертай парцел"}
              </Button>
              {polygon.length >= 3 && (
                <Button size="sm" variant="outline" onClick={clearDrawing}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="border-t border-border pt-3">
              <ParcelImport
                onImported={(res) => {
                  const ring = res.geometry.coordinates[0] as [number, number][];
                  applyImportedPolygon(ring);
                  if (res.name && !name) setName(res.name);
                }}
              />
            </div>
          </div>

          {/* Bottom bar */}
          <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-4 rounded-2xl border border-border bg-card px-5 py-3 shadow-elevated">
            <div className="text-sm">
              <span className="text-muted-foreground">Площ: </span>
              <span className="font-bold text-primary">{area.toFixed(2)} ха</span>
            </div>
            <Button onClick={() => setStep(2)} disabled={polygon.length < 3} className="bg-primary hover:bg-primary/90">
              Напред <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 py-8">
            <h1 className="text-2xl font-bold">Детайли за посева</h1>
            <p className="mt-1 text-sm text-muted-foreground">Тази информация настройва FAO-56 калкулацията за твоя парцел.</p>

            <div className="mt-8 space-y-6">
              <div>
                <Label htmlFor="name">Име на парцела</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Нива при Пловдив" className="mt-1.5" />
              </div>

              <div>
                <Label>Вид посев</Label>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {(Object.keys(CROP_LABELS) as CropType[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCrop(c)}
                      className={`relative flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-sm transition ${
                        crop === c ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      {crop === c && <Check className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-primary" />}
                      <span className="text-2xl">{CROP_ICONS[c]}</span>
                      <span className="font-medium">{CROP_LABELS[c]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="phase">Фаза на растеж</Label>
                <Select value={phase} onValueChange={(v) => setPhase(v as GrowthPhase)}>
                  <SelectTrigger id="phase" className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PHASE_LABELS) as GrowthPhase[]).map((p) => (
                      <SelectItem key={p} value={p}>{PHASE_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="pump" className="flex items-center gap-1.5">
                  <Gauge className="h-3.5 w-3.5" />
                  Дебит на помпата (м³/час) <span className="text-xs font-normal text-muted-foreground">— по избор</span>
                </Label>
                <Input
                  id="pump"
                  type="number"
                  min="0"
                  step="0.1"
                  value={pumpFlow}
                  onChange={(e) => setPumpFlow(e.target.value)}
                  placeholder="напр. 6"
                  className="mt-1.5"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Използва се за изчисляване на колко часа трябва да работи помпата за препоръчаното количество вода.
                </p>
              </div>

              {/* Preview */}
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-primary">Преглед</div>
                <div className="mt-3 flex items-center gap-3">
                  <span className="text-3xl">{CROP_ICONS[crop]}</span>
                  <div>
                    <div className="font-semibold">{name || "Нов парцел"}</div>
                    <div className="text-sm text-muted-foreground">{CROP_LABELS[crop]} · {PHASE_LABELS[phase]} · {area.toFixed(2)} ха</div>
                  </div>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  Първа спътникова анализа: <span className="font-semibold text-foreground">{firstAnalysis}</span>
                </div>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="mr-1 h-4 w-4" /> Назад</Button>
                <Button onClick={handleSave} disabled={saving} className="flex-1 bg-primary hover:bg-primary/90">
                  {saving ? "Запазване..." : "Запази парцела"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
