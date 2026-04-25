import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, X, BarChart3, LogOut, Loader2, Zap, Search } from "lucide-react";
import { NotificationsBell } from "@/components/NotificationsBell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import { ParcelMap } from "@/components/ParcelMap";
import { ParcelDetail, type LiveParcelData } from "@/components/ParcelDetail";
import { WaterDeficitModal } from "@/components/WaterDeficitModal";
import { DeficitScheduleView } from "@/components/DeficitScheduleView";
import { WeatherWidget } from "@/components/WeatherWidget";
import { EditModeBar } from "@/components/EditModeBar";
import { useRealtimeStatus } from "@/hooks/useRealtimeStatus";
import type { DeficitPlan } from "@/lib/deficitPlanner";
import { CROP_ICONS, CROP_LABELS, STATUS_COLORS, type MockParcel, type CropType, type GrowthPhase, type IrrigationStatus } from "@/lib/mockData";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { convertWater } from "@/lib/waterUnits";
import { updateParcelGeometry } from "@/server/parcel.functions";
import { useServerFn } from "@tanstack/react-start";
import { geometryCentroid } from "@/lib/weather";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Табло — HydroLand" },
      { name: "description", content: "Управлявай парцелите си и виж препоръки за напояване от Sentinel-2." },
    ],
  }),
  component: Dashboard,
});

type ParcelRow = {
  id: string;
  name: string;
  crop_type: string;
  growth_phase: string;
  area_hectares: number;
  geometry: string;
  pump_flow_m3h: number | null;
  soil_type: string | null;
  soil_ph: number | null;
  soil_organic_carbon: number | null;
  soil_clay_pct: number | null;
  soil_sand_pct: number | null;
  soil_silt_pct: number | null;
};

type RecRow = {
  parcel_id: string;
  status: string;
  dose_mm: number;
  reason: string;
};

function Dashboard() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bannerOpen, setBannerOpen] = useState(true);
  const [tooltipOpen, setTooltipOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [parcels, setParcels] = useState<MockParcel[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [liveByParcel, setLiveByParcel] = useState<Record<string, LiveParcelData>>({});
  const [liveLoadingId, setLiveLoadingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [soilLoadingId, setSoilLoadingId] = useState<string | null>(null);
  const [soilErrorByParcel, setSoilErrorByParcel] = useState<Record<string, string>>({});

  // Deficit mode
  const [deficitModalOpen, setDeficitModalOpen] = useState(false);
  const [deficitPlan, setDeficitPlan] = useState<DeficitPlan | null>(null);
  const [deficitParams, setDeficitParams] = useState<{
    availablePct: number;
    dateFrom: Date;
    dateTo: Date;
    parcelIds: string[];
  } | null>(null);
  const [showScheduleView, setShowScheduleView] = useState(false);

  const realtimeStatus = useRealtimeStatus();

  // --- Edit shape state ---
  const [editingId, setEditingId] = useState<string | null>(null);
  // Live polygon while user is dragging vertices.
  const [draftGeometry, setDraftGeometry] = useState<GeoJSON.Polygon | null>(null);
  const [draftAreaHa, setDraftAreaHa] = useState<number | null>(null);
  const [savingShape, setSavingShape] = useState(false);
  const updateGeometryFn = useServerFn(updateParcelGeometry);

  // beforeunload guard while editing
  useEffect(() => {
    if (!editingId) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Имаш незапазени промени. Сигурен ли си?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editingId]);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth" });
  }, [authLoading, user, navigate]);

  // Load parcels + latest recommendations
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoadingData(true);
      const { data: p, error } = await supabase
        .from("parcels")
        .select("id, name, crop_type, growth_phase, area_hectares, geometry, pump_flow_m3h, soil_type, soil_ph, soil_organic_carbon, soil_clay_pct, soil_sand_pct, soil_silt_pct")
        .order("created_at", { ascending: false });
      if (error) {
        toast.error(error.message);
        setLoadingData(false);
        return;
      }
      const ids = (p ?? []).map((x) => x.id);
      let recs: RecRow[] = [];
      let ndmiRows: { parcel_id: string; ndmi_value: number; ndvi_value: number; recorded_at: string }[] = [];
      if (ids.length > 0) {
        const [{ data: r }, { data: nd }] = await Promise.all([
          supabase
            .from("irrigation_recommendations")
            .select("parcel_id, status, dose_mm, reason, created_at")
            .in("parcel_id", ids)
            .order("created_at", { ascending: false }),
          supabase
            .from("ndmi_readings")
            .select("parcel_id, ndmi_value, ndvi_value, recorded_at")
            .in("parcel_id", ids)
            .order("recorded_at", { ascending: false }),
        ]);
        // Keep only latest per parcel
        const seen = new Set<string>();
        recs = (r ?? []).filter((row) => {
          if (seen.has(row.parcel_id)) return false;
          seen.add(row.parcel_id);
          return true;
        });
        const seenN = new Set<string>();
        ndmiRows = (nd ?? []).filter((row) => {
          if (seenN.has(row.parcel_id)) return false;
          seenN.add(row.parcel_id);
          return true;
        });
      }

      const merged: MockParcel[] = (p ?? []).map((row: ParcelRow) => {
        const rec = recs.find((x) => x.parcel_id === row.id);
        const nd = ndmiRows.find((x) => x.parcel_id === row.id);
        let geometry: GeoJSON.Polygon;
        try {
          geometry = JSON.parse(row.geometry);
        } catch {
          geometry = { type: "Polygon", coordinates: [[]] };
        }
        return {
          id: row.id,
          name: row.name,
          crop_type: row.crop_type as CropType,
          growth_phase: row.growth_phase as GrowthPhase,
          area_hectares: Number(row.area_hectares),
          geometry,
          status: (rec?.status ?? "yellow") as IrrigationStatus,
          dose_mm: Number(rec?.dose_mm ?? 0),
          reason: rec?.reason ?? "Все още няма анализ. Първа спътникова проверка скоро.",
          ndmi: nd ? Number(nd.ndmi_value) : 0.15,
          ndvi: nd ? Number(nd.ndvi_value) : 0.6,
          recorded_at: nd?.recorded_at ?? new Date().toISOString(),
          forecast: [],
          pump_flow_m3h: row.pump_flow_m3h,
          soil_type: row.soil_type,
          soil_ph: row.soil_ph == null ? null : Number(row.soil_ph),
          soil_organic_carbon: row.soil_organic_carbon == null ? null : Number(row.soil_organic_carbon),
          soil_clay_pct: row.soil_clay_pct == null ? null : Number(row.soil_clay_pct),
          soil_sand_pct: row.soil_sand_pct == null ? null : Number(row.soil_sand_pct),
          soil_silt_pct: row.soil_silt_pct == null ? null : Number(row.soil_silt_pct),
        };
      });
      if (!cancelled) {
        setParcels(merged);
        setLoadingData(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Merge any freshly-fetched live NDMI back into the parcel list so
  // the map's water batteries reflect the latest per-parcel value.
  const parcelsWithLive = useMemo(() => {
    if (Object.keys(liveByParcel).length === 0) return parcels;
    return parcels.map((p) => {
      const live = liveByParcel[p.id];
      if (!live) return p;
      return { ...p, ndmi: live.ndmi, ndvi: live.ndvi };
    });
  }, [parcels, liveByParcel]);

  const selected = parcelsWithLive.find((p) => p.id === selectedId) ?? null;

  // Refs to list items so a polygon click on the map can scroll the corresponding
  // sidebar entry into view.
  const listItemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  useEffect(() => {
    if (!selectedId) return;
    const el = listItemRefs.current[selectedId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  // Centroid of all parcels — used to anchor the dashboard weather widget.
  const allParcelsCentroid = useMemo(() => {
    if (parcels.length === 0) return null;
    let sx = 0, sy = 0, n = 0;
    for (const p of parcels) {
      const c = geometryCentroid(p.geometry);
      if (c) { sx += c.lon; sy += c.lat; n++; }
    }
    if (!n) return null;
    return { lat: sy / n, lon: sx / n };
  }, [parcels]);

  // Real-time search filter: name, crop label, or status label
  const filteredParcels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return parcelsWithLive;
    return parcelsWithLive.filter((p) => {
      const cropLbl = CROP_LABELS[p.crop_type]?.toLowerCase() ?? "";
      const statusLbl = STATUS_COLORS[p.status]?.label.toLowerCase() ?? "";
      return (
        p.name.toLowerCase().includes(q) ||
        p.crop_type.toLowerCase().includes(q) ||
        cropLbl.includes(q) ||
        statusLbl.includes(q) ||
        p.status.toLowerCase().includes(q)
      );
    });
  }, [parcelsWithLive, searchQuery]);

  // Fetch fresh multi-source NDMI when a parcel is selected (cached per parcel)
  useEffect(() => {
    if (!selectedId) return;
    if (liveByParcel[selectedId]) return;
    let cancelled = false;
    setLiveLoadingId(selectedId);
    fetch("/api/fetch-ndmi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parcel_id: selectedId }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Omit<LiveParcelData, "fetchedAt"> & { fetchedAt?: string }>;
      })
      .then((json) => {
        if (cancelled) return;
        setLiveByParcel((m) => ({
          ...m,
          [selectedId]: { ...json, fetchedAt: new Date() } as LiveParcelData,
        }));
      })
      .catch((err) => {
        console.error("fetch-ndmi failed:", err);
        if (!cancelled) toast.error("Неуспешно зареждане на спътникови данни");
      })
      .finally(() => {
        if (!cancelled) setLiveLoadingId((id) => (id === selectedId ? null : id));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Auto-enrich soil for the selected parcel if it doesn't have a soil_type yet.
  useEffect(() => {
    if (!selectedId) return;
    const parcel = parcels.find((p) => p.id === selectedId);
    if (!parcel) return;
    if (parcel.soil_type) return; // already enriched
    let cancelled = false;
    setSoilLoadingId(selectedId);
    setSoilErrorByParcel((m) => {
      const next = { ...m };
      delete next[selectedId];
      return next;
    });
    fetch("/api/enrich-soil", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parcel_id: selectedId }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
        return j as {
          soil_type: string | null;
          soil_ph: number | null;
          soil_organic_carbon: number | null;
          soil_clay_pct: number | null;
          soil_sand_pct: number | null;
          soil_silt_pct: number | null;
        };
      })
      .then((j) => {
        if (cancelled) return;
        setParcels((prev) =>
          prev.map((p) =>
            p.id === selectedId
              ? {
                  ...p,
                  soil_type: j.soil_type ?? p.soil_type,
                  soil_ph: j.soil_ph ?? p.soil_ph,
                  soil_organic_carbon: j.soil_organic_carbon ?? p.soil_organic_carbon,
                  soil_clay_pct: j.soil_clay_pct ?? p.soil_clay_pct,
                  soil_sand_pct: j.soil_sand_pct ?? p.soil_sand_pct,
                  soil_silt_pct: j.soil_silt_pct ?? p.soil_silt_pct,
                }
              : p,
          ),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setSoilErrorByParcel((m) => ({
          ...m,
          [selectedId]: "Почвените данни временно недостъпни.",
        }));
        console.error("enrich-soil failed:", err);
      })
      .finally(() => {
        if (!cancelled) setSoilLoadingId((id) => (id === selectedId ? null : id));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Keyboard shortcut: N -> Add parcel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        navigate({ to: "/add-parcel" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const today = new Date().toLocaleDateString("bg-BG", {
    day: "numeric", month: "long", year: "numeric",
  });

  // Per-parcel deficit allocation lookup
  const deficitByParcel = useMemo(() => {
    const m = new Map<string, { deficitDose: number; normalDose: number; reductionPct: number; priority: string }>();
    if (!deficitPlan) return m;
    deficitPlan.allocations.forEach((a) => {
      m.set(a.parcel_id, {
        deficitDose: a.deficitDose,
        normalDose: a.normalDose,
        reductionPct: a.reductionPct,
        priority: a.priority,
      });
    });
    return m;
  }, [deficitPlan]);

  const deficitActive = !!deficitPlan && !!deficitParams;

  const handleGenerateDeficit = (
    plan: DeficitPlan,
    params: { availablePct: number; dateFrom: Date; dateTo: Date; parcelIds: string[] },
  ) => {
    setDeficitPlan(plan);
    setDeficitParams(params);
    setDeficitModalOpen(false);
    setShowScheduleView(true);
    toast.success("Графикът при воден дефицит е генериран");
  };

  const handleDeactivateDeficit = () => {
    setDeficitPlan(null);
    setDeficitParams(null);
    setShowScheduleView(false);
    toast("Режимът на воден дефицит е изключен");
  };

  if (authLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (showScheduleView && deficitPlan && deficitParams) {
    return (
      <DeficitScheduleView
        plan={deficitPlan}
        parcels={parcels}
        availablePct={deficitParams.availablePct}
        dateFrom={deficitParams.dateFrom}
        dateTo={deficitParams.dateTo}
        onBack={() => setShowScheduleView(false)}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-3 sm:px-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen((v) => !v)} aria-label="Меню">
            <BarChart3 className="h-5 w-5" />
          </Button>
          <Logo />
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">{today}</span>
          <span className="hidden text-xs text-muted-foreground md:inline">{user.email}</span>
          <span
            className={`hidden items-center gap-1.5 text-xs sm:inline-flex ${
              realtimeStatus === "connected" ? "text-emerald-600" : "text-muted-foreground"
            }`}
            title={realtimeStatus === "connected" ? "Realtime активен" : "Офлайн режим"}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                realtimeStatus === "connected" ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40"
              }`}
            />
            {realtimeStatus === "connected" ? "Realtime свързан" : "Офлайн режим"}
          </span>
          <WeatherWidget center={allParcelsCentroid} />
          <NotificationsBell />
          <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="Изход">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Deficit mode banner */}
      {deficitActive && deficitParams && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900">
          <span>
            <Zap className="mr-1 inline h-4 w-4" />
            <b>Активен воден дефицит</b> · {deficitParams.availablePct}% · до{" "}
            {deficitParams.dateTo.toLocaleDateString("bg-BG")}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setShowScheduleView(true)}
              className="rounded-md border border-amber-400 bg-white px-2 py-0.5 text-xs font-semibold hover:bg-amber-50"
            >
              Виж график
            </button>
            <button
              onClick={handleDeactivateDeficit}
              className="rounded-md border border-amber-400 bg-white px-2 py-0.5 text-xs font-semibold hover:bg-amber-50"
            >
              Деактивирай
            </button>
          </div>
        </div>
      )}

      {/* Demo banner */}
      {bannerOpen && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-secondary/30 bg-secondary/10 px-4 py-2 text-sm">
          <span className="text-foreground">
            <span className="font-semibold text-secondary">Твоето табло</span> — добави парцел и получи реални спътникови препоръки на всеки 5 дни
          </span>
          <button onClick={() => setBannerOpen(false)} className="rounded-md p-1 hover:bg-secondary/20" aria-label="Затвори банер">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="relative flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`absolute inset-y-0 left-0 z-30 flex w-[320px] flex-col border-r border-sidebar-border bg-sidebar transition-transform lg:static lg:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          <div className="border-b border-sidebar-border px-4 py-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Моите парцели</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                {searchQuery ? `${filteredParcels.length}/${parcels.length}` : parcels.length}
              </span>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Търси по име, култура или статус…"
                className="h-8 pl-8 text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-muted"
                  aria-label="Изчисти"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {loadingData ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : parcels.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Все още нямаш парцели. Добави първия си!
              </div>
            ) : filteredParcels.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Няма парцели, които да съответстват на „{searchQuery}".
              </div>
            ) : (
              <ul className="space-y-2">
                {filteredParcels.map((p) => {
                  const s = STATUS_COLORS[p.status];
                  const active = p.id === selectedId;
                  const da = deficitByParcel.get(p.id);
                  const deficitBadge = da
                    ? da.priority === "critical"
                      ? { text: "Пълна доза", cls: "bg-emerald-100 text-emerald-700" }
                      : da.deficitDose === 0
                      ? { text: "Пропуска се", cls: "bg-muted text-muted-foreground" }
                      : { text: "Намалена", cls: "bg-amber-100 text-amber-800" }
                    : null;
                  return (
                    <li key={p.id} ref={(el) => { listItemRefs.current[p.id] = el; }}>
                      <button
                        onClick={() => { setSelectedId(p.id); setSidebarOpen(false); }}
                        className={`w-full rounded-xl border p-3 text-left transition ${
                          active ? "border-primary bg-primary/5 shadow-card" : "border-border bg-card hover:border-primary/40 hover:bg-accent/30"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xl shrink-0">{CROP_ICONS[p.crop_type]}</span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    realtimeStatus === "connected" ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40"
                                  }`}
                                  title={realtimeStatus === "connected" ? "Realtime активен" : "Офлайн"}
                                />
                                {p.name}
                              </div>
                              <div className="text-xs text-muted-foreground">{CROP_LABELS[p.crop_type]} · {p.area_hectares} ха</div>
                            </div>
                          </div>
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full mt-1.5" style={{ backgroundColor: s.fill }} />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
                          <div className="flex items-center gap-1">
                            <span className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase" style={{ backgroundColor: `${s.fill}20`, color: s.fill }}>
                              {s.label}
                            </span>
                            {deficitBadge && (
                              <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${deficitBadge.cls}`}>
                                {deficitBadge.text}
                              </span>
                            )}
                          </div>
                          <span className="text-sm font-bold" style={{ color: s.fill }}>
                            {(() => {
                              const mm = da ? da.deficitDose : p.dose_mm;
                              const m3 = convertWater(mm, p.area_hectares).totalM3;
                              return `${m3.toFixed(1)} м³`;
                            })()}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Stats */}
            <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Статистика</div>
              <ul className="space-y-1.5 text-sm">
                <li className="flex justify-between"><span className="text-muted-foreground">Общо парцели</span><span className="font-semibold">{parcels.length}</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">Спестена вода</span><span className="font-semibold text-primary">~{parcels.length * 800} л</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">CO₂ намаление</span><span className="font-semibold text-primary">~{(parcels.length * 0.3).toFixed(1)} кг</span></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-sidebar-border p-3 space-y-2">
            <Button
              variant="outline"
              onClick={() => setDeficitModalOpen(true)}
              className="w-full border-amber-400 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
            >
              <Zap className="mr-2 h-4 w-4" />
              Воден дефицит
            </Button>
            <Link to="/add-parcel">
              <Button className="w-full bg-primary hover:bg-primary/90">
                <Plus className="mr-2 h-4 w-4" />
                Добави парцел
              </Button>
            </Link>
            <p className="text-center text-[10px] text-muted-foreground">
              Натисни <kbd className="rounded border border-border bg-muted px-1 font-mono">N</kbd> за бърз достъп
            </p>
          </div>
        </aside>

        {/* Map area */}
        <main className="relative flex-1 overflow-hidden">
          <ParcelMap
            parcels={filteredParcels}
            selectedId={selectedId}
            onSelect={(id) => {
              if (editingId) return; // Block while editing.
              setSelectedId(id);
            }}
            editingParcelId={editingId}
            hidePlaceSearch={!!editingId}
            onEditingGeometryChange={(g, ha) => {
              setDraftGeometry(g);
              setDraftAreaHa(ha);
            }}
          />

          {/* First-time tooltip */}
          {tooltipOpen && !selected && parcels.length > 0 && !editingId && (
            <div className="pointer-events-auto absolute left-1/2 top-6 z-10 -translate-x-1/2 animate-fade-in">
              <div className="flex items-center gap-3 rounded-full border border-primary/30 bg-card px-4 py-2.5 shadow-elevated">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                <span className="text-sm font-medium">Кликни на парцел в картата за детайли</span>
                <button onClick={() => setTooltipOpen(false)} className="rounded-md p-0.5 hover:bg-muted" aria-label="Затвори">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Detail side panel — hidden while editing so the map gets full width */}
          {selected && !editingId && (
            <ParcelDetail
              parcel={selected}
              onClose={() => setSelectedId(null)}
              liveData={liveByParcel[selected.id] ?? null}
              loadingLive={liveLoadingId === selected.id}
              soilLoading={soilLoadingId === selected.id}
              soilError={soilErrorByParcel[selected.id] ?? null}
              isEditing={false}
              editAreaHa={draftAreaHa}
              onStartEdit={() => {
                setEditingId(selected.id);
                setDraftGeometry(selected.geometry);
                setDraftAreaHa(selected.area_hectares);
              }}
              saving={savingShape}
              onDelete={async (id) => {
                const { error } = await supabase.from("parcels").delete().eq("id", id);
                if (error) throw error;
                setParcels((prev) => prev.filter((p) => p.id !== id));
                setLiveByParcel((m) => {
                  const next = { ...m };
                  delete next[id];
                  return next;
                });
                setSelectedId(null);
              }}
            />
          )}

          {/* Floating edit bar — only when editing. Side panel is hidden. */}
          {selected && editingId === selected.id && (
            <EditModeBar
              parcelName={selected.name}
              originalAreaHa={selected.area_hectares}
              liveAreaHa={draftAreaHa}
              saving={savingShape}
              onCancel={() => {
                setEditingId(null);
                setDraftGeometry(null);
                setDraftAreaHa(null);
              }}
              onSave={async () => {
                if (!editingId || !draftGeometry) return;
                setSavingShape(true);
                try {
                  const { data: sessionData } = await supabase.auth.getSession();
                  const token = sessionData.session?.access_token;
                  if (!token) throw new Error("Сесията е изтекла. Моля влез отново.");
                  const res = await updateGeometryFn({
                    data: { parcel_id: editingId, geometry: draftGeometry },
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  setParcels((prev) =>
                    prev.map((p) =>
                      p.id === editingId
                        ? { ...p, geometry: draftGeometry, area_hectares: res.area_hectares }
                        : p,
                    ),
                  );
                  toast.success(`Формата е запазена · ${(res.area_hectares * 10).toFixed(2)} дка`);
                  setEditingId(null);
                  setDraftGeometry(null);
                  setDraftAreaHa(null);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Грешка при записа");
                } finally {
                  setSavingShape(false);
                }
              }}
            />
          )}
        </main>
      </div>

      <WaterDeficitModal
        open={deficitModalOpen}
        onOpenChange={setDeficitModalOpen}
        parcels={parcels}
        onGenerate={handleGenerateDeficit}
      />
    </div>
  );
}
