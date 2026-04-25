import { useState } from "react";
import { X, Droplets, Calendar, Satellite, Share2, CloudRain, Loader2, Trash2, Gauge, Pencil, Save, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import type { MockParcel } from "@/lib/mockData";
import { CROP_ICONS, CROP_LABELS, STATUS_COLORS } from "@/lib/mockData";
import { DataQualityBanner, type DataSource } from "@/components/DataQualityBanner";
import { ForecastChart, type ForecastDay } from "@/components/ForecastChart";
import { WaterBattery, ndmiToMoisturePct } from "@/components/WaterBattery";
import { convertWater, formatHours, formatPerDka, formatTotal, pumpRuntimeHours } from "@/lib/waterUnits";
import { PhenophaseTimeline } from "@/components/PhenophaseTimeline";
import { QuickIrrigationActions } from "@/components/QuickIrrigationActions";
import { WateringLog } from "@/components/WateringLog";
import { SoilBalanceChart } from "@/components/SoilBalanceChart";
import { ParcelHistoryDialog } from "@/components/ParcelHistoryDialog";
import { WeatherForecast } from "@/components/WeatherForecast";
import { SoilInfoCard } from "@/components/SoilInfoCard";

export interface LiveParcelData {
  ndmi: number;
  ndvi: number;
  source: DataSource;
  confidence: number;
  cloudCoverage: number;
  rainfall_mm: number;
  eto: number;
  dose_mm: number;
  status: "green" | "yellow" | "red";
  reason: string;
  forecast: ForecastDay[];
  fetchedAt: Date;
}

interface ParcelDetailProps {
  parcel: MockParcel;
  onClose: () => void;
  liveData?: LiveParcelData | null;
  loadingLive?: boolean;
  onDelete?: (id: string) => Promise<void> | void;
  /** True when this parcel is in edit-shape mode. */
  isEditing?: boolean;
  /** Live area while editing (hectares); undefined when not editing. */
  editAreaHa?: number | null;
  /** Toggle edit mode on. */
  onStartEdit?: () => void;
  /** Save the new polygon. */
  onSaveEdit?: () => Promise<void> | void;
  /** Discard edits. */
  onCancelEdit?: () => void;
  /** True while save is in progress. */
  saving?: boolean;
  /** Soil data fetch in progress. */
  soilLoading?: boolean;
  /** Error from the soil enrichment endpoint. */
  soilError?: string | null;
  /** Open the edit-everything modal (name/crop/phase/area). */
  onEditDetails?: () => void;
  /** Retry soil enrichment from the dashboard. */
  onRetrySoil?: () => void;
}

function IndexBar({ value, label }: { value: number; label: string }) {
  const pct = ((value + 1) / 2) * 100;
  const status = value < -0.1 ? "Лошо" : value < 0.25 ? "Нормално" : "Добро";
  const statusColor =
    value < -0.1 ? "text-red-600" : value < 0.25 ? "text-amber-600" : "text-emerald-600";
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className={`font-semibold ${statusColor}`}>{status}</span>
      </div>
      <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full" style={{ background: "linear-gradient(90deg, #dc2626 0%, #d97706 50%, #16a34a 100%)" }}>
        <div className="absolute top-0 h-full w-1 -translate-x-1/2 rounded-full bg-foreground shadow-md" style={{ left: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>Лошо</span><span>Нормално</span><span>Добро</span>
      </div>
    </div>
  );
}

function MockForecastChart({ data, areaHectares }: { data: MockParcel["forecast"]; areaHectares: number }) {
  const max = Math.max(...data.map((d) => d.dose), 1);
  const fmtM3 = (mm: number) => {
    // 1 mm on 1 dka = 1 m³; area_dka = areaHectares × 10
    const m3 = mm * areaHectares * 10;
    if (m3 >= 1000) return `${(m3 / 1000).toFixed(1)}к м³`;
    return `${m3.toFixed(1)} м³`;
  };
  return (
    <div>
      <svg viewBox="0 0 320 110" className="w-full">
        {data.map((d, i) => {
          const x = i * 45 + 8;
          const h = (d.dose / max) * 55;
          const y = 70 - h;
          const color = d.dose === 0 ? "#16a34a" : d.dose < 4 ? "#d97706" : "#dc2626";
          return (
            <g key={i}>
              <text x={x + 14} y={y - 4} textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor" className="text-foreground">
                {d.dose > 0 ? fmtM3(d.dose) : "0 м³"}
              </text>
              <rect x={x} y={y} width="28" height={h} rx="3" fill={color} opacity="0.85" />
              {d.rain && <text x={x + 14} y={y - 16} textAnchor="middle" fontSize="11">💧</text>}
              <text x={x + 14} y={88} textAnchor="middle" fontSize="9" fill="currentColor" className="text-muted-foreground">{d.day}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function ParcelDetail({ parcel, onClose, liveData, loadingLive, onDelete, isEditing = false, editAreaHa = null, onStartEdit, onSaveEdit, onCancelEdit, saving = false, soilLoading = false, soilError = null, onEditDetails, onRetrySoil }: ParcelDetailProps) {
  // Prefer live data when present; otherwise fall back to whatever was on the parcel.
  const ndmi = liveData?.ndmi ?? parcel.ndmi;
  const ndvi = liveData?.ndvi ?? parcel.ndvi;
  const dose = liveData?.dose_mm ?? parcel.dose_mm;
  const reason = liveData?.reason ?? parcel.reason;
  const statusKey = (liveData?.status ?? parcel.status) as keyof typeof STATUS_COLORS;
  const status = STATUS_COLORS[statusKey];

  const handleShare = async () => {
    const sourceLbl = liveData
      ? liveData.source === "sentinel-2"
        ? "Sentinel-2"
        : liveData.source === "sentinel-1-sar"
          ? "Sentinel-1 SAR"
          : "ERA5 модел"
      : "Sentinel-2";
    const shareM3 = convertWater(dose, parcel.area_hectares).totalM3.toFixed(1);
    const text = `HydroLand препоръчва: Полей нива '${parcel.name}' с ${shareM3} м³ тази седмица (статус: ${status.label.toLowerCase()}). Анализирано от ${sourceLbl}.`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Препоръката е копирана");
    } catch {
      toast.error("Неуспешно копиране");
    }
  };

  const recordedAgo = Math.round((Date.now() - new Date(parcel.recorded_at).getTime()) / 86400000);
  const isSar = liveData?.source === "sentinel-1-sar";

  return (
    <>
      {/* Backdrop */}
      <div className="absolute inset-0 z-10 bg-foreground/10 backdrop-blur-[1px]" onClick={isEditing ? undefined : onClose} />
      {/* Panel */}
      <aside className="absolute right-0 top-0 z-20 flex h-full w-full max-w-[400px] flex-col overflow-y-auto border-l border-border bg-card shadow-elevated animate-slide-in-right">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-card/95 p-4 backdrop-blur">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{CROP_ICONS[parcel.crop_type]}</span>
              <h2 className="text-lg font-bold">{parcel.name}</h2>
              {onEditDetails && !isEditing && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onEditDetails}
                  aria-label="Редактирай парцела"
                  title="Редактирай парцела"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {CROP_LABELS[parcel.crop_type]} ·{" "}
              {isEditing && editAreaHa != null ? (
                <span>
                  <b className="text-amber-700">{editAreaHa.toFixed(2)} ха</b>
                  <span className="ml-1 text-xs">
                    ({(editAreaHa * 10).toFixed(1)} дка
                    {(() => {
                      const d = (editAreaHa - parcel.area_hectares) * 10;
                      const sign = d >= 0 ? "+" : "";
                      const cls = d > 0 ? "text-emerald-600" : d < 0 ? "text-red-600" : "text-muted-foreground";
                      return <span className={`ml-1 font-semibold ${cls}`}>{sign}{d.toFixed(2)} дка спрямо преди</span>;
                    })()})
                  </span>
                </span>
              ) : (
                <span>{parcel.area_hectares} ха ({(parcel.area_hectares * 10).toFixed(1)} дка)</span>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Затвори">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Edit-mode action bar — sticky at top of panel */}
        {isEditing && (
          <div className="sticky top-[72px] z-10 border-b-2 border-amber-400 bg-amber-50 px-4 py-3 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-900">
              <Pencil className="h-3.5 w-3.5" /> Редактиране на форма на парцела
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => onSaveEdit?.()}
                disabled={saving}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Запази промените
              </Button>
              <Button
                onClick={() => onCancelEdit?.()}
                disabled={saving}
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Ban className="mr-2 h-4 w-4" />
                Откажи
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-amber-800">
              Влачи ъглите за нова форма · кликни в средата на ръба за нов ъгъл · двойно кликване изтрива ъгъл.
            </p>
          </div>
        )}

        <div className="space-y-5 p-4">
          {/* Data quality banner — live mode only */}
          {loadingLive ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Зареждам последни спътникови данни…
            </div>
          ) : liveData ? (
            <DataQualityBanner
              source={liveData.source}
              confidence={liveData.confidence}
              cloudCoverage={liveData.cloudCoverage}
              lastUpdated={liveData.fetchedAt}
            />
          ) : null}

          {/* Recommendation */}
          <div className="rounded-2xl border-2 p-5 shadow-card" style={{ borderColor: status.fill, backgroundColor: `${status.fill}10` }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-4 w-4">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50" style={{ backgroundColor: status.fill }} />
                    <span className="relative inline-flex h-4 w-4 rounded-full" style={{ backgroundColor: status.fill }} />
                  </span>
                  <span className="text-sm font-semibold uppercase tracking-wide" style={{ color: status.fill }}>{status.label}</span>
                </div>
                {(() => {
                  const u = convertWater(dose, parcel.area_hectares);
                  return (
                    <>
                      <div className="mt-4 flex items-baseline gap-2">
                        <Droplets className="h-7 w-7" style={{ color: status.fill }} />
                        <span className="text-4xl font-bold leading-none" style={{ color: status.fill }}>
                          {u.totalM3.toFixed(1)}
                        </span>
                        <span className="text-xl font-medium text-muted-foreground">м³</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        тази седмица · {Math.round(u.totalLiters).toLocaleString("bg-BG")} л
                      </div>
                    </>
                  );
                })()}
              </div>
              {/* Water battery */}
              <WaterBattery moisturePct={ndmiToMoisturePct(ndmi)} />
            </div>
            <p className="mt-3 text-sm text-foreground">{reason}</p>
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {liveData
                ? `Обновено току-що · валежи последните 7 дни: ${convertWater(liveData.rainfall_mm, parcel.area_hectares).totalM3.toFixed(1)} м³`
                : `Обновено преди ${recordedAgo} ${recordedAgo === 1 ? "ден" : "дни"}`}
            </div>
          </div>

          {/* Water units conversion */}
          {dose > 0 && (() => {
            const units = convertWater(dose, parcel.area_hectares);
            const runtime = pumpRuntimeHours(units.totalM3, parcel.pump_flow_m3h);
            return (
              <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
                <div className="mb-3 flex items-center gap-2">
                  <Droplets className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Преизчислено в литри и кубици</h3>
                </div>
                <div className="space-y-2.5">
                  <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <span className="font-mono text-foreground">{formatPerDka(units)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2.5">
                    <div>
                      <div className="text-xs text-muted-foreground">За целия парцел</div>
                      <div className="font-bold text-primary">{formatTotal(units)}</div>
                    </div>
                    <div className="text-right text-[11px] text-muted-foreground">{parcel.area_hectares} ха ({(parcel.area_hectares * 10).toFixed(1)} дка)</div>
                  </div>
                  {parcel.pump_flow_m3h && runtime !== null ? (
                    <div className="flex items-center gap-2 rounded-lg border border-secondary/40 bg-secondary/5 px-3 py-2.5">
                      <Gauge className="h-4 w-4 shrink-0 text-secondary" />
                      <div className="text-sm">
                        Помпа <b>{parcel.pump_flow_m3h} м³/ч</b> → работа{" "}
                        <b className="text-secondary">{formatHours(runtime)}</b>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                      <Gauge className="h-3.5 w-3.5 shrink-0" />
                      Добави дебит на помпата в настройките за да виждаш време за работа.
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Indices */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
            <div className="mb-4 flex items-center gap-2">
              <Satellite className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">
                {isSar ? "Радарни индекси" : "Спътникови индекси"}
              </h3>
            </div>
            <div className="space-y-4">
              <IndexBar value={ndmi} label={isSar ? "SAR влажност (VH/VV)" : "NDMI (влажност)"} />
              {!isSar && <IndexBar value={ndvi} label="NDVI (вегетация)" />}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              {liveData
                ? `Източник: ${liveData.source}`
                : `Измерено от Sentinel-2, преди ${recordedAgo} ${recordedAgo === 1 ? "ден" : "дни"}`}
            </p>
          </div>

          {/* Phenophase timeline + dynamic Kc */}
          <PhenophaseTimeline cropType={parcel.crop_type} ndvi={ndvi} />

          {/* 7-day weather forecast (Open-Meteo) for this parcel */}
          <WeatherForecast geometry={parcel.geometry} />

          {/* Watering log — "Полях днес" with NDMI correction + history */}
          <WateringLog
            parcelId={parcel.id}
            parcelName={parcel.name}
            cropType={parcel.crop_type}
            growthPhase={parcel.growth_phase}
            currentNDMI={ndmi}
            recommendedDoseMM={dose}
            soilType={parcel.soil_type ?? null}
          />

          {/* Rain logging stays separate */}
          <QuickIrrigationActions
            parcelId={parcel.id}
            parcelName={parcel.name}
            geometry={parcel.geometry}
            areaHectares={parcel.area_hectares}
          />

          {/* Soil moisture balance trend (auto-updated daily by cron) */}
          <SoilBalanceChart
            parcelId={parcel.id}
            cropType={parcel.crop_type}
            growthPhase={parcel.growth_phase}
          />

          {/* ISRIC SoilGrids — soil type, pH, organic carbon, retention */}
          <SoilInfoCard
            soilType={parcel.soil_type}
            soilTypeBg={parcel.soil_type_bg}
            soilFcPct={parcel.soil_fc_pct}
            soilWpPct={parcel.soil_wp_pct}
            soilAwcPct={parcel.soil_awc_pct}
            soilPh={parcel.soil_ph}
            soilOrganicCarbon={parcel.soil_organic_carbon}
            loading={soilLoading}
            error={soilError}
            onRetry={onRetrySoil}
          />

          {/* Forecast */}
          {liveData && liveData.forecast.length > 0 ? (
            <ForecastChart forecast={liveData.forecast} source={liveData.source} areaHectares={parcel.area_hectares} />
          ) : parcel.forecast.length > 0 ? (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <div className="mb-3 flex items-center gap-2">
                <CloudRain className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">7-дневна прогноза</h3>
              </div>
              <MockForecastChart data={parcel.forecast} areaHectares={parcel.area_hectares} />
            </div>
          ) : null}

          {/* Savings */}
          <div className="flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Спестявания спрямо традиционно</div>
              <div className="mt-0.5 text-lg font-bold text-primary">~32% по-малко вода</div>
            </div>
            <div className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
              ECO
            </div>
          </div>

          <Button onClick={handleShare} className="w-full" variant="outline" disabled={isEditing}>
            <Share2 className="mr-2 h-4 w-4" />
            Сподели препоръката
          </Button>

          {/* Edit shape + history */}
          {onStartEdit && !isEditing && (
            <Button onClick={onStartEdit} className="w-full" variant="outline">
              <Pencil className="mr-2 h-4 w-4" />
              ✏️ Редактирай форма
            </Button>
          )}
          <ParcelHistoryDialog parcelId={parcel.id} parcelName={parcel.name} />

          {onDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Изтрий парцела
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Изтриване на „{parcel.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Това действие е необратимо. Парцелът и свързаните спътникови измервания и препоръки ще бъдат премахнати.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отказ</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      try {
                        await onDelete(parcel.id);
                        toast.success("Парцелът е изтрит");
                        onClose();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Грешка при изтриването");
                      }
                    }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Изтрий
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </aside>
    </>
  );
}
