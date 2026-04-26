import { useState } from "react";
import { X, Satellite, Share2, CloudRain, Loader2, Trash2, Pencil, Save, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
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
import { type DataSource } from "@/components/DataQualityBanner";
import { ForecastChart, type ForecastDay } from "@/components/ForecastChart";
import { ndmiToMoisturePct } from "@/components/WaterBattery";
import { convertWater } from "@/lib/waterUnits";
import { PhenophaseTimeline } from "@/components/PhenophaseTimeline";
import { GrowthPhaseIndicator } from "@/components/GrowthPhaseIndicator";
import { QuickIrrigationActions } from "@/components/QuickIrrigationActions";
import { WateringLog } from "@/components/WateringLog";
import { ParcelHistoryDialog } from "@/components/ParcelHistoryDialog";
import { WeatherForecast } from "@/components/WeatherForecast";
import { SoilInfoCard } from "@/components/SoilInfoCard";
import { SatelliteDataSection } from "@/components/SatelliteDataSection";
import { IrrigationCard } from "@/components/IrrigationCard";

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
  /** Patch the cached liveData for this parcel after a "Полях днес" confirm/undo. */
  onIrrigationChange?: (patch: {
    ndmi: number;
    dose_mm: number;
    status: "green" | "yellow" | "red";
    reason: string;
    forecastTransform: (
      prev: { date: string; dose_mm: number; status: "green" | "yellow" | "red" }[],
    ) => { date: string; dose_mm: number; status: "green" | "yellow" | "red" }[];
  }) => void;
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

export function ParcelDetail({ parcel, onClose, liveData, loadingLive, onDelete, isEditing = false, editAreaHa = null, onStartEdit, onSaveEdit, onCancelEdit, saving = false, soilLoading = false, soilError = null, onEditDetails, onRetrySoil, onIrrigationChange }: ParcelDetailProps) {
  const { t } = useTranslation();
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
      toast.success(t("parcelDetail.shareCopied"));
    } catch {
      toast.error(t("parcelDetail.shareFailed"));
    }
  };

  const recordedAgo = Math.round((Date.now() - new Date(parcel.recorded_at).getTime()) / 86400000);
  const isSar = liveData?.source === "sentinel-1-sar";

  return (
    <>
      {/* Click-catcher over the map area only (left of the panel) — keeps the
          selected parcel visible and unblurred while still letting the user
          click outside to close. Disabled while editing. */}
      {!isEditing && (
        <div
          className="absolute inset-y-0 left-0 z-10 right-0 sm:right-[400px]"
          onClick={onClose}
          aria-hidden
        />
      )}
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
                  aria-label={t("parcelDetail.edit")}
                  title={t("parcelDetail.edit")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {t(`crops.${parcel.crop_type}`)} ·{" "}
              {isEditing && editAreaHa != null ? (
                <span>
                  <b className="text-amber-700">{editAreaHa.toFixed(2)} {t("units.ha")}</b>
                  <span className="ml-1 text-xs">
                    ({(editAreaHa * 10).toFixed(1)} {t("units.dka")}
                    {(() => {
                      const d = (editAreaHa - parcel.area_hectares) * 10;
                      const sign = d >= 0 ? "+" : "";
                      const cls = d > 0 ? "text-emerald-600" : d < 0 ? "text-red-600" : "text-muted-foreground";
                      return <span className={`ml-1 font-semibold ${cls}`}>{sign}{d.toFixed(2)} {t("units.dka")}</span>;
                    })()})
                  </span>
                </span>
              ) : (
                <span>{parcel.area_hectares} {t("units.ha")} ({(parcel.area_hectares * 10).toFixed(1)} {t("units.dka")})</span>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("parcelDetail.close")}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Growth phase indicator — directly below header */}
        <div className="border-b border-border bg-card/50 px-4 py-3">
          <GrowthPhaseIndicator
            cropType={parcel.crop_type}
            growthPhase={parcel.growth_phase}
            onChangePhase={onEditDetails}
          />
        </div>

        {/* Missing-boundary warning */}
        {(() => {
          const ring = parcel.geometry?.coordinates?.[0] as [number, number][] | undefined;
          if (ring && ring.length >= 3) return null;
          return (
            <div className="border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
              {t("parcelDetail.missingBoundary")}
            </div>
          );
        })()}

        {/* Edit-mode action bar — sticky at top of panel */}
        {isEditing && (
          <div className="sticky top-[72px] z-10 border-b-2 border-amber-400 bg-amber-50 px-4 py-3 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-900">
              <Pencil className="h-3.5 w-3.5" /> {t("parcelDetail.editingTitle")}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => onSaveEdit?.()}
                disabled={saving}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {t("parcelDetail.saveChanges")}
              </Button>
              <Button
                onClick={() => onCancelEdit?.()}
                disabled={saving}
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Ban className="mr-2 h-4 w-4" />
                {t("parcelDetail.cancel")}
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-amber-800">
              {t("parcelDetail.editingHint")}
            </p>
          </div>
        )}

        <div className="space-y-5 p-4">
          {/* Data quality banner — live mode only */}
          {loadingLive && (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Зареждам последни спътникови данни…
            </div>
          )}

          {/* Main irrigation recommendation — daily-first, parcel-only volumes */}
          <IrrigationCard
            parcelId={parcel.id}
            areaHectares={parcel.area_hectares}
            pumpFlowM3h={parcel.pump_flow_m3h}
            status={statusKey as "green" | "yellow" | "red"}
            ndmi={ndmi}
            moisturePct={ndmiToMoisturePct(ndmi)}
            forecast={
              liveData?.forecast && liveData.forecast.length > 0
                ? liveData.forecast
                : (parcel.forecast as unknown as ForecastDay[]).map((d, i) => ({
                    date: new Date(Date.now() + i * 86400_000).toISOString().slice(0, 10),
                    dose_mm: (d as unknown as { dose: number }).dose ?? 0,
                    status:
                      ((d as unknown as { dose: number }).dose ?? 0) === 0
                        ? "green"
                        : ((d as unknown as { dose: number }).dose ?? 0) < 4
                          ? "yellow"
                          : "red",
                  }))
            }
            rain7dMm={liveData?.rainfall_mm ?? 0}
            source={liveData?.source ?? null}
            fetchedAt={liveData?.fetchedAt ?? null}
            confidence={liveData?.confidence ?? null}
            cloudCoverage={liveData?.cloudCoverage ?? null}
          />

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
            currentStatus={statusKey as "green" | "yellow" | "red"}
            soilType={parcel.soil_type ?? null}
            areaHectares={parcel.area_hectares}
            onIrrigationChange={onIrrigationChange}
          />

          {/* Rain logging stays separate */}
          <QuickIrrigationActions
            parcelId={parcel.id}
            parcelName={parcel.name}
            geometry={parcel.geometry}
            areaHectares={parcel.area_hectares}
            currentNDMI={ndmi}
            recommendedDoseMM={dose}
            cropType={parcel.crop_type}
            growthPhase={parcel.growth_phase}
            soilType={parcel.soil_type ?? null}
            onIrrigationChange={onIrrigationChange}
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

          {/* Satellite data sources — which satellites + what each value means */}
          <SatelliteDataSection
            parcelId={parcel.id}
            parcelCreatedAt={(parcel as unknown as { created_at?: string }).created_at ?? null}
            ndmi={ndmi}
            ndvi={ndvi}
            eto={liveData?.eto ?? null}
            fcPct={parcel.soil_fc_pct ?? null}
            wpPct={parcel.soil_wp_pct ?? null}
            dataSource={liveData?.source ?? null}
          />

          {/* Phenophase timeline + dynamic Kc — moved below satellite data */}
          <PhenophaseTimeline
            parcelId={parcel.id}
            cropType={parcel.crop_type}
            sowingDate={parcel.sowing_date ?? null}
            ndvi={ndvi}
            onEditDetails={onEditDetails}
          />

          {/* Forecast panel hidden — data still flows through IrrigationCard's
              weekly table. Re-enable by restoring <ForecastChart /> here. */}


          <Button onClick={handleShare} className="w-full" variant="outline" disabled={isEditing}>
            <Share2 className="mr-2 h-4 w-4" />
            Сподели препоръката
          </Button>

          {/* Edit shape + history */}
          {onStartEdit && !isEditing && (
            <Button onClick={onStartEdit} className="w-full" variant="outline">
              <Pencil className="mr-2 h-4 w-4" />
              Редактирай форма
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
