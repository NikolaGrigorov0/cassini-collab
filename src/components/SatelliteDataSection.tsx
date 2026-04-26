import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type ViewMode = "farmer" | "technical";
const STORAGE_KEY = "aquadose_satellite_view_mode";

interface Props {
  parcelId: string;
  parcelCreatedAt?: string | null;
  ndmi: number;
  ndvi: number;
  eto?: number | null;
  fcPct?: number | null;
  wpPct?: number | null;
  dataSource?: string | null;
}

interface SourceMeta {
  used: boolean;
  lastPass: Date | null;
}

interface SourcesState {
  "sentinel-2": SourceMeta;
  "sentinel-1": SourceMeta;
  era5: SourceMeta;
  galileo: SourceMeta;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("bg-BG", { day: "numeric", month: "short", year: "numeric" });
}

function ageLabel(d: Date | null): string {
  if (!d) return "няма данни";
  const diff = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff <= 0) return "днес";
  if (diff === 1) return "вчера";
  return `преди ${diff} дни`;
}

function freshnessColor(d: Date | null): string {
  if (!d) return "bg-muted";
  const diff = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 6) return "bg-green-500";
  if (diff < 12) return "bg-amber-500";
  return "bg-red-500";
}

type Rating = { label: "Лошо" | "Нормално" | "Добро"; emoji: string; hint: string };

function ratingFromPct(pct: number, hints: { good: string; ok: string; bad: string }): Rating {
  if (pct >= 70) return { label: "Добро", emoji: "🟢", hint: hints.good };
  if (pct >= 40) return { label: "Нормално", emoji: "🟡", hint: hints.ok };
  return { label: "Лошо", emoji: "🔴", hint: hints.bad };
}

function ndmiRating(pct: number): Rating {
  return ratingFromPct(pct, {
    good: "Растенията са добре наводнени",
    ok: "Лека жажда — скоро ще трябва вода",
    bad: "Растенията са жадни — полей скоро",
  });
}

function ndviRating(v: number): Rating {
  // NDVI 0..1 → проценти базирани на типичния обхват за здрав посев
  if (v > 0.6) return { label: "Добро", emoji: "🟢", hint: "Гъста и здрава растителност" };
  if (v >= 0.3) return { label: "Нормално", emoji: "🟡", hint: "Умерена растителност" };
  return { label: "Лошо", emoji: "🔴", hint: "Слаба растителност или гола почва" };
}

function moistureRating(pct: number): Rating {
  return ratingFromPct(pct, {
    good: "Почвата е добре напоена",
    ok: "Влагата е средна — следи прогнозата",
    bad: "Под критичния праг — полей веднага!",
  });
}

function ndmiToPct(ndmi: number, fc?: number | null, wp?: number | null): number {
  // Fallback simple linear mapping when soil-specific thresholds missing.
  const fcN = fc ?? 0.4;
  const wpN = wp ?? -0.1;
  if (fcN <= wpN) return 0;
  const pct = ((ndmi - wpN) / (fcN - wpN)) * 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Range bar for NDMI / NDVI from -1..+1 with marker at current value.
 */
function RangeBar({ value }: { value: number }) {
  const clamped = Math.max(-1, Math.min(1, value));
  const pct = ((clamped + 1) / 2) * 100;
  return (
    <div className="relative h-3 w-full rounded-full overflow-hidden"
      style={{ background: "linear-gradient(90deg, #ef4444 0%, #f59e0b 50%, #22c55e 100%)" }}>
      <div
        className="absolute top-1/2 -translate-y-1/2 h-5 w-1 bg-foreground rounded shadow"
        style={{ left: `calc(${pct}% - 2px)` }}
      />
    </div>
  );
}

/**
 * Semicircle gauge for moisture % (0..100) with red/yellow/green zones.
 */
function SemiGauge({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="space-y-1">
      <div className="relative h-2 w-full rounded-full overflow-hidden flex">
        <div className="h-full" style={{ width: "70%", background: "#ef4444" }} />
        <div className="h-full" style={{ width: "10%", background: "#f59e0b" }} />
        <div className="h-full" style={{ width: "20%", background: "#22c55e" }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-4 w-1 bg-foreground rounded"
          style={{ left: `calc(${v}% - 2px)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>0%</span><span>70%</span><span>80%</span><span>100%</span>
      </div>
    </div>
  );
}

interface SatCardData {
  key: keyof SourcesState;
  org: string;
  emoji: string;
  name: string;
  badge: string;
  badgeClass: string;
  farmer: string;
  technical: string;
  techFooter: string;
  farmerFooter: (lastPass: Date | null) => string;
}

const SATS: SatCardData[] = [
  {
    key: "sentinel-2",
    org: "ESA · Copernicus",
    emoji: "🛰️",
    name: "Sentinel-2",
    badge: "Оптичен",
    badgeClass: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    farmer:
      "Фотографира полето ти като камера от космоса. Вижда здравето на растенията по цвета им.",
    technical:
      "Multispectral optical\n13 bands · 10m resolution\n5-day revisit time\nBands used: B04 B08 B11",
    techFooter: "NDMI · NDVI · NDWI",
    farmerFooter: (d) => `Последен пасаж: ${fmtDate(d)}`,
  },
  {
    key: "sentinel-1",
    org: "ESA · Copernicus",
    emoji: "🛰️",
    name: "Sentinel-1",
    badge: "Радар",
    badgeClass: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    farmer:
      "Работи като прилеп — изпраща радиовълни и ги улавя обратно. Вижда през облаци и нощем.",
    technical:
      "SAR (C-band, 5.4 GHz)\nIW mode · 10m resolution\n6-day revisit time\nPolarization: VV + VH",
    techFooter: "Soil moisture proxy\nVH/VV backscatter ratio",
    farmerFooter: (d) => `Последен пасаж: ${fmtDate(d)}`,
  },
  {
    key: "era5",
    org: "ECMWF · Copernicus",
    emoji: "🌦️",
    name: "ERA5",
    badge: "Метео модел",
    badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    farmer:
      "Не е спътник, а компютърен модел на времето. Използва се когато облаците скрият полето.",
    technical:
      "Reanalysis dataset\n0.25° spatial resolution\nHourly temporal resolution\nVariables: tp · t2m · pev",
    techFooter: "ETo via Penman-Monteith",
    farmerFooter: () => "Данни от последните 7 дни",
  },
  {
    key: "galileo",
    org: "ESA · EU",
    emoji: "🛰️",
    name: "Galileo / EGNOS",
    badge: "Навигация",
    badgeClass: "bg-green-500/15 text-green-600 dark:text-green-400",
    farmer:
      "Европейската GPS система. Определя точно границите на твоя парцел с точност до 1 метър.",
    technical:
      "European GNSS system\nSub-meter accuracy with EGNOS\nUsed for: parcel boundary\ngeolocation verification",
    techFooter: "Accuracy: <1m (EGNOS)",
    farmerFooter: () => "Активен",
  },
];

export function SatelliteDataSection({
  parcelId,
  parcelCreatedAt,
  ndmi,
  ndvi,
  eto,
  fcPct,
  wpPct,
  dataSource,
}: Props) {
  const [open, setOpen] = useState(true);
  const [howOpen, setHowOpen] = useState(false);
  const [mode, setMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "farmer";
    return (localStorage.getItem(STORAGE_KEY) as ViewMode) || "farmer";
  });
  const [sources, setSources] = useState<SourcesState>({
    "sentinel-2": { used: false, lastPass: null },
    "sentinel-1": { used: false, lastPass: null },
    era5: { used: true, lastPass: new Date() },
    galileo: {
      used: true,
      lastPass: parcelCreatedAt ? new Date(parcelCreatedAt) : new Date(),
    },
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  // Load latest Sentinel-2 pass from ndmi_readings (real data only).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("ndmi_readings")
        .select("data_source, recorded_at")
        .eq("parcel_id", parcelId)
        .order("recorded_at", { ascending: false })
        .limit(20);
      if (cancelled || !data) return;
      const s2 = data.find((r) => (r.data_source ?? "").includes("sentinel-2"));
      if (s2) {
        setSources((prev) => ({
          ...prev,
          "sentinel-2": { used: true, lastPass: new Date(s2.recorded_at) },
        }));
      } else if (dataSource?.includes("sentinel-2")) {
        setSources((prev) => ({
          ...prev,
          "sentinel-2": { used: true, lastPass: new Date() },
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parcelId, dataSource]);

  const moisturePct = ndmiToPct(ndmi, fcPct, wpPct);
  const ndmiR = ndmiRating(moisturePct);
  const ndviR = ndviRating(ndvi);
  const moistR = moistureRating(moisturePct);
  const visibleSats = SATS.filter((s) => sources[s.key].used);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 p-4">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-left flex-1 min-w-0"
        >
          <span className="text-lg">📡</span>
          <h3 className="text-sm font-semibold truncate">Сателитни данни</h3>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {/* Pill toggle */}
        <div className="inline-flex rounded-full border border-border bg-muted p-0.5 text-xs shrink-0">
          <button
            onClick={() => setMode("farmer")}
            className={`px-2.5 py-1 rounded-full transition-colors ${
              mode === "farmer" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"
            }`}
          >
            🌾 Фермер
          </button>
          <button
            onClick={() => setMode("technical")}
            className={`px-2.5 py-1 rounded-full transition-colors ${
              mode === "technical" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"
            }`}
          >
            🔬 Технически
          </button>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-5">
          {/* Active satellites */}
          {visibleSats.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Източници използвани за този парцел
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                {visibleSats.map((s) => {
                  const meta = sources[s.key];
                  return (
                    <div
                      key={s.key}
                      className="shrink-0 w-[140px] rounded-xl border-2 border-green-500/60 bg-background p-3 space-y-2"
                    >
                      <div className="text-[10px] text-muted-foreground truncate">{s.org}</div>
                      <div className="text-2xl">{s.emoji}</div>
                      <div className="text-sm font-semibold leading-tight">{s.name}</div>
                      <span
                        className={`inline-block text-[10px] px-2 py-0.5 rounded-full ${s.badgeClass}`}
                      >
                        {s.badge}
                      </span>
                      <p className="text-[11px] leading-snug text-foreground/80 whitespace-pre-line min-h-[60px]">
                        {mode === "farmer" ? s.farmer : s.technical}
                      </p>
                      <div className="text-[10px] text-muted-foreground whitespace-pre-line border-t border-border pt-1">
                        {mode === "farmer" ? s.farmerFooter(meta.lastPass) : s.techFooter}
                      </div>
                      <span className="inline-block text-[10px] text-green-600 dark:text-green-400 font-medium">
                        ✓ Използван
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Data values */}
          <div className="space-y-4">
            <div className="text-xs font-medium text-muted-foreground">
              Измерени стойности за този парцел
            </div>

            {/* NDMI */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">NDMI</span>
                <span className="text-sm font-mono">
                  {mode === "farmer" ? `${ndmiR.label} ${ndmiR.emoji}` : ndmi.toFixed(2)}
                </span>
              </div>
              <RangeBar value={ndmi} />
              <p className="text-xs text-muted-foreground whitespace-pre-line">
                {mode === "farmer"
                  ? ndmiR.hint
                  : "Normalized Difference Moisture Index\nNDMI = (B08 - B11) / (B08 + B11)\nNIR (842nm) vs SWIR (1610nm)\nSensitive to canopy water content"}
              </p>
            </div>

            {/* NDVI */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">NDVI</span>
                <span className="text-sm font-mono">
                  {mode === "farmer" ? `${ndviR.label} ${ndviR.emoji}` : ndvi.toFixed(2)}
                </span>
              </div>
              <RangeBar value={ndvi} />
              <p className="text-xs text-muted-foreground whitespace-pre-line">
                {mode === "farmer"
                  ? ndviR.hint
                  : "Normalized Difference Vegetation Index\nNDVI = (B08 - B04) / (B08 + B04)\nNIR (842nm) vs Red (665nm)\nProxy for biomass and crop health"}
              </p>
            </div>

            {/* Moisture % */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Влага (% ППВ)</span>
                <span className="text-sm font-mono">
                  {mode === "farmer" ? `${moistR.label} ${moistR.emoji}` : `${moisturePct.toFixed(0)}%`}
                </span>
              </div>
              <SemiGauge value={moisturePct} />
              <p className="text-xs text-muted-foreground whitespace-pre-line">
                {mode === "farmer"
                  ? moistR.hint
                  : "% of Field Water Capacity (ППВ)\nDerived from NDMI using soil-specific\nFC and WP NDMI thresholds:\npct = (NDMI - WP) / (FC - WP) × 100\nThresholds vary by soil texture"}
              </p>
            </div>

            {/* ETo — only technical */}
            {mode === "technical" && eto != null && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">ETo (Евапотранспирация)</span>
                  <span className="text-sm font-mono">{eto.toFixed(1)} mm/ден</span>
                </div>
                <p className="text-xs text-muted-foreground whitespace-pre-line">
                  Reference Evapotranspiration{"\n"}
                  Penman-Monteith equation (FAO-56){"\n"}
                  Source: ERA5 t2m + wind + humidity{"\n"}
                  Used to calculate ETc = ETo × Kc
                </p>
              </div>
            )}
          </div>

          {/* Freshness timeline */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2">
              Последно обновяване на данните
            </div>
            <ul className="space-y-1.5">
              {visibleSats.map((s) => {
                const meta = sources[s.key];
                return (
                  <li key={s.key} className="flex items-center gap-2 text-xs">
                    <span className={`h-2.5 w-2.5 rounded-full ${freshnessColor(meta.lastPass)}`} />
                    <span className="font-medium w-24 truncate">{s.name}</span>
                    <span className="text-muted-foreground w-28">{fmtDate(meta.lastPass)}</span>
                    <span className="text-muted-foreground">{ageLabel(meta.lastPass)}</span>
                  </li>
                );
              })}
            </ul>
            {mode === "technical" && sources["sentinel-2"].lastPass && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                Следващ пасаж Sentinel-2: ~
                {fmtDate(
                  new Date(sources["sentinel-2"].lastPass!.getTime() + 5 * 86400000),
                )}
              </div>
            )}
          </div>

          {/* How it works */}
          <div className="border-t border-border pt-3">
            <button
              onClick={() => setHowOpen((o) => !o)}
              className="flex items-center gap-2 text-sm font-medium text-foreground/80 hover:text-foreground"
            >
              {howOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Как работи?
            </button>
            {howOpen && (
              <div className="mt-3">
                {mode === "farmer" ? (
                  <ol className="space-y-3">
                    <li className="flex gap-3">
                      <span className="text-xl shrink-0">🛰️</span>
                      <div>
                        <div className="text-sm font-semibold">Спътникът минава над полето ти</div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          На всеки 5 дни Sentinel-2 прави снимка на твоя парцел от 786 км височина.
                        </p>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="text-xl shrink-0">🌈</span>
                      <div>
                        <div className="text-sm font-semibold">Анализира невидимата светлина</div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Камерата вижда инфрачервена светлина която човешкото око не може. Здравите растения я отразяват повече.
                        </p>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="text-xl shrink-0">💻</span>
                      <div>
                        <div className="text-sm font-semibold">Компютърът изчислява жаждата</div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Сравняваме светлината от растенията с международния FAO-56 стандарт и изчисляваме точно колко вода им трябва.
                        </p>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="text-xl shrink-0">📱</span>
                      <div>
                        <div className="text-sm font-semibold">Ти получаваш препоръката</div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          За секунди резултатът е при теб — точна доза в m³/дка без скъпи датчици в земята.
                        </p>
                      </div>
                    </li>
                  </ol>
                ) : (
                  <pre className="rounded-lg bg-gray-900 text-green-400 font-mono text-[11px] leading-relaxed p-3 overflow-x-auto whitespace-pre">
{`[Sentinel-2 L2A TOA]
    → Atmospheric correction (Sen2Cor)
    → Band extraction: B04, B08, B11
    → NDMI = (B08-B11)/(B08+B11)
    → NDVI = (B08-B04)/(B08+B04)
         ↓
[ERA5 Reanalysis]
    → t2m, wind, humidity, solar radiation
    → Penman-Monteith → ETo (mm/day)
         ↓
[FAO-56 Calculation]
    → ETc = ETo × Kc(crop, phase)
    → NDMI → %ППВ (soil-specific)
    → dose = ETc × 7 × deficit_factor
         ↓
[Supabase Edge Function]
    → Saves to irrigation_recommendations
    → Triggers Realtime update
         ↓
[React Dashboard]
    → Displays recommendation to farmer`}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}