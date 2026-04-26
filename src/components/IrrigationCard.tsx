// Main irrigation recommendation card — daily-first view.
//
// Replaces the old "weekly m³" card that was confusing for farmers.
// Shows: today's dose in mm + farmer units (m³/дка, л/дка, pump hours),
// rain deduction, tomorrow preview, smart time-of-day messaging,
// collapsible weekly table, and a clean data-source footer.
//
// All weekly volumes are PARCEL-level only — never region/watershed totals.

import { useEffect, useState } from "react";
import { Droplets, Calendar, ChevronDown, ChevronUp, CloudRain, CheckCircle2, Gauge, Zap, Satellite, Radar, CloudOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { convertWater, formatHours, pumpRuntimeHours } from "@/lib/waterUnits";
import type { ForecastDay } from "@/components/ForecastChart";
import type { DataSource } from "@/components/DataQualityBanner";

interface Props {
  parcelId: string;
  areaHectares: number;
  pumpFlowM3h: number | null | undefined;
  status: "green" | "yellow" | "red";
  ndmi: number;
  moisturePct: number; // 0-100
  /** Daily forecast (forecast[0] = today, forecast[1] = tomorrow). */
  forecast: ForecastDay[];
  /** Sum of rainfall in last 7 days (mm) — from ERA5/Open-Meteo history. */
  rain7dMm: number;
  /** Data source for the satellite reading. */
  source: DataSource | null;
  /** Last fetched timestamp (for the source line). */
  fetchedAt: Date | null;
  /** Pipeline confidence percent (0-100). */
  confidence?: number | null;
  /** Cloud coverage percent (0-100) reported by Sentinel-2. */
  cloudCoverage?: number | null;
}

function fmtM3(m3: number): string {
  if (m3 >= 1000) return `${(m3 / 1000).toFixed(1)}к м³`;
  return `${m3.toFixed(1)} м³`;
}

const STATUS_LABEL: Record<Props["status"], string> = {
  green: "БЕЗ ВОДЕН СТРЕС",
  yellow: "УМЕРЕН ВОДЕН СТРЕС",
  red: "СИЛЕН ВОДЕН СТРЕС",
};
const STATUS_DOT: Record<Props["status"], string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
};
const STATUS_COLOR: Record<Props["status"], string> = {
  green: "#16a34a",
  yellow: "#d97706",
  red: "#dc2626",
};

const SOURCE_LABEL: Record<DataSource, string> = {
  "sentinel-2": "Sentinel-2",
  "sentinel-1-sar": "Sentinel-1 (радар)",
  "era5-model": "ERA5 модел",
};

const DOW_BG = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("bg-BG", { day: "numeric", month: "short" });
}

function smartStatusText(
  status: Props["status"],
  rainToday: number,
  hour: number,
): string {
  if (rainToday > 0) {
    return `Валя днес ${rainToday.toFixed(1)}mm — изчакай почвата да поеме водата преди да решиш дали да поливаш.`;
  }
  // Morning < 12, afternoon 12-18, evening >= 18
  if (hour < 12) {
    if (status === "red") return "Полей преди обяд — следобед е по-горещо и водата се изпарява по-бързо.";
    if (status === "yellow") return "Планирай поливане за днес или утре сутринта.";
    return "Днес не е нужно поливане. Следи утре.";
  }
  if (hour < 18) {
    if (status === "red") return "Полей вечерта — поливането в жегата губи вода от изпарение.";
    if (status === "yellow") return "Полей довечера или утре сутринта рано.";
    return "Всичко е наред за днес.";
  }
  if (status === "red") return "Полей сега или рано утре — нощното поливане е ефективно.";
  if (status === "yellow") return "Можеш да полееш сега или утре сутринта.";
  return "Готово за днес. Провери утре.";
}

interface TodayEvent {
  amount_mm: number;
  dose_mm: number | null;
}

export function IrrigationCard({
  parcelId,
  areaHectares,
  pumpFlowM3h,
  status,
  ndmi,
  moisturePct,
  forecast,
  rain7dMm,
  source,
  fetchedAt,
  confidence,
  cloudCoverage,
}: Props) {
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const [todayEvent, setTodayEvent] = useState<TodayEvent | null>(null);

  // Detect "watered today" by querying irrigation_events for today (excluding rain & undone).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const todayStr = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("irrigation_events")
        .select("amount_mm, dose_mm, method")
        .eq("parcel_id", parcelId)
        .eq("undone", false)
        .eq("date", todayStr)
        .neq("method", "rain")
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const ev = data?.[0];
      if (ev) setTodayEvent({ amount_mm: Number(ev.amount_mm), dose_mm: ev.dose_mm == null ? null : Number(ev.dose_mm) });
      else setTodayEvent(null);
    })();
    return () => { cancelled = true; };
  }, [parcelId]);

  const today = forecast[0];
  const tomorrow = forecast[1];
  const etcToday = today?.etc_mm ?? today?.eto_mm ?? 0;
  const rainToday = today?.rain_mm ?? 0;
  const doseToday = today?.dose_mm ?? 0;

  const tomorrowDose = tomorrow?.dose_mm ?? 0;
  const tomorrowRain = tomorrow?.rain_mm ?? 0;

  const areaDka = areaHectares * 10;
  const u = convertWater(doseToday, areaHectares);
  const m3PerDka = doseToday; // 1mm × 1дка = 1m³
  const litersPerDka = doseToday * 1000;
  const totalM3 = doseToday * areaDka;
  const pumpHrs = pumpRuntimeHours(totalM3, pumpFlowM3h);

  const now = new Date();
  const hour = now.getHours();

  // ----- Determine which STATE the today-box is in -----
  // STATE 2: already watered today
  const isWatered = todayEvent != null;
  // STATE 4: rain expected today (>0.5mm and not yet watered)
  const rainExpected = rainToday > 0.5 && !isWatered;
  // STATE 3: green status, no irrigation needed
  const noNeed = status === "green" && doseToday === 0 && !isWatered;

  // ----- Effective status (after accounting for today's irrigation) -----
  // Ако фермерът вече е полял днес, не показваме "Силен воден стрес".
  const effectiveStatus: Props["status"] = isWatered ? "green" : status;

  // ----- Card background -----
  let cardBg = "bg-amber-50 border-amber-200";
  if (effectiveStatus === "red") cardBg = "bg-red-50 border-red-200";
  if (isWatered) cardBg = "bg-emerald-50 border-emerald-200";
  else if (rainExpected) cardBg = "bg-blue-50 border-blue-200";
  else if (noNeed) cardBg = "bg-emerald-50 border-emerald-200";

  // ----- Smart status text -----
  const statusText = smartStatusText(status, rainToday, hour);

  // ----- "Polei dnes" suggestion banner -----
  const showUrgentBanner = !isWatered && doseToday > 0 && tomorrowDose > doseToday;

  // ----- Weekly totals (parcel-level only) -----
  const week = forecast.slice(0, 7);
  const totalNeed = week.reduce((s, d) => s + (d.etc_mm ?? d.eto_mm ?? 0), 0);
  const totalRainWk = week.reduce((s, d) => s + (d.rain_mm ?? 0), 0);
  const totalDose = week.reduce((s, d) => s + (d.dose_mm ?? 0), 0);
  const weekTotalM3PerDka = totalDose; // mm/dka == m3/dka
  const weekTotalM3 = totalDose * areaDka;
  const weekPumpHrs = pumpRuntimeHours(weekTotalM3, pumpFlowM3h);

  // ----- Source line -----
  const sourceLabel = source ? SOURCE_LABEL[source] : "Sentinel-2";
  const sourceDate = fetchedAt ? formatDateShort(fetchedAt.toISOString()) : "сега";

  return (
    <div className={`rounded-2xl border-2 p-5 shadow-card ${cardBg}`}>
      {/* Header: status badge (reflects today's irrigation) */}
      <div className="flex items-center gap-2">
        <span className="text-lg">{STATUS_DOT[effectiveStatus]}</span>
        <span
          className="text-sm font-semibold uppercase tracking-wide"
          style={{ color: STATUS_COLOR[effectiveStatus] }}
        >
          {isWatered ? "ПОЛЯТО ДНЕС" : STATUS_LABEL[effectiveStatus]}
        </span>
      </div>

      {/* Compact data-source badge — replaces standalone DataQualityBanner */}
      {source && (
        <div
          className={`mt-2 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
            source === "sentinel-2"
              ? "border-green-200 bg-green-50 text-green-700"
              : source === "sentinel-1-sar"
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {source === "sentinel-2" ? (
            <Satellite className="h-3.5 w-3.5 shrink-0" />
          ) : source === "sentinel-1-sar" ? (
            <Radar className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <CloudOff className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="whitespace-normal leading-snug">
            {source === "sentinel-2"
              ? `Sentinel-2 оптичен · точност ${confidence ?? 90}%`
              : source === "sentinel-1-sar"
                ? `Sentinel-1 радар · облачност ${cloudCoverage ?? 0}% · точност ${confidence ?? 75}%`
                : `ERA5 модел · продължителна облачност · точност ${confidence ?? 65}%`}
          </span>
        </div>
      )}

      {/* Urgent "polei dnes" banner */}
      {showUrgentBanner && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-100/70 px-3 py-2 text-xs text-amber-900">
          <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Препоръчваме да полеете <b>днес</b> — утре нуждата ще е по-голяма (
            <b>{fmtM3(tomorrowDose * areaDka)}</b>).
          </span>
        </div>
      )}

      {/* ДНЕС box */}
      <div className="mt-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Днес</div>

        {/* STATE 2 — Watered today */}
        {isWatered && (
          <div className="rounded-xl border border-emerald-300 bg-white/60 p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              <div>
                <div className="text-lg font-bold text-emerald-700">
                  Полято днес — {fmtM3(Number(todayEvent.dose_mm ?? todayEvent.amount_mm) * areaDka)}
                </div>
                <div className="mt-0.5 text-xs text-emerald-800">
                  Следващо поливане:{" "}
                  {tomorrowDose > 0
                    ? `утре (~${fmtM3(tomorrowDose * areaDka)})`
                    : nextNonZeroDay(forecast, areaDka)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STATE 3 — No irrigation needed (green) */}
        {!isWatered && noNeed && (
          <div className="rounded-xl border border-emerald-300 bg-white/60 p-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">💧✕</span>
              <div>
                <div className="text-lg font-bold text-emerald-700">Днес не е нужно поливане</div>
                <div className="mt-0.5 text-xs text-emerald-800">
                  {rainToday > 0
                    ? `Дъждът покри нуждата (${rainToday.toFixed(1)}mm)`
                    : `Влагата е достатъчна (${Math.round(moisturePct)}% ППВ)`}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STATE 4 — Rain expected today */}
        {!isWatered && rainExpected && (
          <div className="rounded-xl border border-blue-300 bg-white/60 p-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🌧️</span>
              <div>
                <div className="text-lg font-bold text-blue-700">
                  Очакван дъжд {rainToday.toFixed(1)}mm
                </div>
                <div className="mt-0.5 text-xs text-blue-800">
                  {rainToday >= etcToday
                    ? "Не е нужно поливане днес"
                    : `Полей ${fmtM3(doseToday * areaDka)} преди дъжда`}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STATE 1 — Needs irrigation */}
        {!isWatered && !noNeed && !rainExpected && (
          <div className="rounded-xl border border-amber-300 bg-white/60 p-4">
            <div className="flex items-baseline gap-2">
              <Droplets className="h-7 w-7 self-center" style={{ color: STATUS_COLOR[status] }} />
              <span className="text-sm font-semibold text-foreground">Полей</span>
              <span className="text-4xl font-bold leading-none" style={{ color: STATUS_COLOR[status] }}>
                {u.totalM3.toFixed(1)}
              </span>
              <span className="text-xl font-medium text-muted-foreground">м³</span>
            </div>
            {pumpFlowM3h && pumpHrs !== null ? (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Gauge className="h-3.5 w-3.5" />
                ⏱ ~{formatHours(pumpHrs)} помпа ({pumpFlowM3h} м³/ч)
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-muted-foreground">
                💡 Добави дебит на помпата в настройките за да виждаш време за работа.
              </div>
            )}
          </div>
        )}

        {/* "Защо" — explanation under the today box */}
        {!isWatered && !noNeed && (
          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            <div>
              <b className="text-foreground">Защо:</b>{" "}
              {rainToday > 0
                ? `Дневна нужда ETc ${etcToday.toFixed(1)}mm − Дъжд ${rainToday.toFixed(1)}mm`
                : `Дневна нужда ETc ${etcToday.toFixed(1)}mm · Без валежи`}
            </div>
            {doseToday > Math.max(0, etcToday - rainToday) + 0.5 && (
              <div>
                <b className="text-foreground">Защо повече от ETc:</b>{" "}
                Почвата е суха ({Math.round(moisturePct)}% ППВ, NDMI {ndmi.toFixed(2)}) —
                препоръката добавя вода за да покрие натрупания дефицит, не само днешната нужда.
              </div>
            )}
            <div>NDMI: {ndmi.toFixed(2)} · {Math.round(moisturePct)}% ППВ</div>
          </div>
        )}
      </div>

      {/* УТРЕ preview */}
      {tomorrow && (
        <div className="mt-4 border-t border-border/60 pt-3">
          <div className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Утре</div>
          {tomorrowDose === 0 ? (
            <div className="text-sm">
              ✓ Не се очаква нужда от поливане
              {tomorrowRain > 0 && <span className="text-muted-foreground"> · 🌧️ Дъжд {fmtM3(tomorrowRain * areaDka)}</span>}
            </div>
          ) : (
            <div className="text-sm">
              ⚠ Подгответе ~<b>{fmtM3(tomorrowDose * areaDka)}</b>
              <span className="text-muted-foreground"> · {tomorrowDose.toFixed(1)} м³/дка</span>
            </div>
          )}
        </div>
      )}

      {/* Smart status sentence */}
      <p className="mt-3 text-sm text-foreground">{statusText}</p>

      {/* Weekly forecast — collapsed by default */}
      <div className="mt-4 border-t border-border/60 pt-3">
        <button
          type="button"
          onClick={() => setWeeklyOpen((v) => !v)}
          className="flex w-full items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          <span className="flex items-center gap-1.5">
            <CloudRain className="h-3.5 w-3.5" />
            Седмична прогноза
          </span>
          {weeklyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {weeklyOpen && (
          <div className="mt-2 overflow-hidden rounded-lg border border-border bg-white/40">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold">Ден</th>
                  <th className="px-2 py-1.5 text-right font-semibold" title="Дневна изпарителна нужда (ETc)">Нужда</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Дъжд</th>
                  <th className="px-2 py-1.5 text-right font-semibold" title="Препоръчана доза (включва натрупан дефицит)">Полей</th>
                </tr>
              </thead>
              <tbody>
                {week.map((d, i) => {
                  const dt = new Date(d.date);
                  const isToday = i === 0;
                  const label = isToday ? "Днес" : i === 1 ? "Утре" : DOW_BG[dt.getDay()];
                  const need = d.etc_mm ?? d.eto_mm ?? 0;
                  return (
                    <tr key={d.date} className={isToday ? "bg-amber-50 font-semibold" : "border-t border-border/40"}>
                      <td className="px-2 py-1.5">{label}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmtM3(need * areaDka)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmtM3((d.rain_mm ?? 0) * areaDka)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmtM3(d.dose_mm * areaDka)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-2 py-1.5">Общо</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtM3(totalNeed * areaDka)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtM3(totalRainWk * areaDka)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtM3(totalDose * areaDka)}</td>
                </tr>
              </tbody>
            </table>
            <div className="border-t border-border bg-primary/5 px-2 py-2 text-xs">
              Общо за седмицата: <b>{weekTotalM3.toFixed(1)} м³</b> ({weekTotalM3PerDka.toFixed(1)} м³/дка)
              {weekPumpHrs !== null && <> · {formatHours(weekPumpHrs)} помпа</>}
            </div>
            <div className="border-t border-border bg-muted/20 px-2 py-2 text-[11px] text-muted-foreground">
              ℹ️ <b>Нужда</b> = дневно изпарение (ETc). <b>Полей</b> = препоръчана доза, която може да е по-голяма ако почвата вече е изсъхнала и трябва да се навакса дефицит.
            </div>
          </div>
        )}
      </div>

      {/* Source line */}
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Calendar className="h-3 w-3" />
        📡 {sourceLabel} · {sourceDate} · Дъжд (7 дни): {rain7dMm.toFixed(1)}mm
      </div>
    </div>
  );
}

function nextNonZeroDay(forecast: ForecastDay[], areaDka: number): string {
  for (let i = 1; i < forecast.length; i++) {
    if ((forecast[i]?.dose_mm ?? 0) > 0) {
      const d = new Date(forecast[i].date);
      const m3 = forecast[i].dose_mm * areaDka;
      const m3Str = m3 >= 1000 ? `${(m3 / 1000).toFixed(1)}к м³` : `${m3.toFixed(1)} м³`;
      return `${d.toLocaleDateString("bg-BG", { day: "numeric", month: "short" })} (~${m3Str})`;
    }
  }
  return "тази седмица не се очаква";
}