import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CloudRain, Loader2, MapPin, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { getRainForGeometry, type RainInfo } from "@/lib/weather";
import { convertWater } from "@/lib/waterUnits";
import {
   recalculateAfterIrrigation,
   recomputeForecast,
   reverseIrrigation,
 } from "@/lib/irrigationCorrection";
import { toast } from "sonner";

interface Props {
  parcelId: string;
  parcelName: string;
  /** GeoJSON Polygon/MultiPolygon (object or stringified). Used to look up rain. */
  geometry?: unknown;
  /** Parcel area in hectares — used to convert mm → liters in messages. */
  areaHectares?: number;
  /** Current NDMI baseline — used to compute soil-moisture lift after rain. */
  currentNDMI?: number;
  /** Latest recommended dose (mm) — used as baseline for forecast scaling. */
  recommendedDoseMM?: number;
  /** Crop + phase passed to recalculateAfterIrrigation (forward-compat). */
  cropType?: string;
  growthPhase?: string;
  /** Soil type (drives NDMI lift multiplier). */
  soilType?: string | null;
  /** Same patch contract as WateringLog — updates dose/status/NDMI/forecast. */
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

type ActionKind = "rain" | null;

interface RainEventRow {
  id: string;
  amount_mm: number;
  dose_mm: number | null;
  created_at: string;
  ndmi_before: number | null;
  status_before: string | null;
  original_dose_mm: number | null;
}

export function QuickIrrigationActions({
  parcelId,
  parcelName,
  geometry,
  areaHectares,
  currentNDMI = 0,
  recommendedDoseMM = 0,
  cropType = "",
  growthPhase = "",
  soilType = null,
  onIrrigationChange,
}: Props) {
  const [kind, setKind] = useState<ActionKind>(null);
  const [amount, setAmount] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Rain auto-lookup state
  const [rainLoading, setRainLoading] = useState(false);
  const [rainInfo, setRainInfo] = useState<RainInfo | null>(null);
  const [rainError, setRainError] = useState<string | null>(null);

  // Today's rain event (drives State 2 card + undo flow)
  const [todaysRain, setTodaysRain] = useState<RainEventRow | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [undoing, setUndoing] = useState(false);

  const loadTodaysRain = useCallback(async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from("irrigation_events")
      .select("id, amount_mm, dose_mm, created_at, ndmi_before, status_before, original_dose_mm, undone, method, parcel_id")
      .eq("parcel_id", parcelId)
      .eq("method", "rain")
      .eq("undone", false)
      .gte("created_at", startOfDay.toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) {
      setTodaysRain(null);
      return;
    }
    setTodaysRain(data[0] as unknown as RainEventRow);
  }, [parcelId]);

  useEffect(() => {
    void loadTodaysRain();
  }, [loadTodaysRain]);

  const lookupRain = async () => {
    if (!geometry) {
      setRainError("Няма геометрия за този парцел.");
      return;
    }
    setRainLoading(true);
    setRainError(null);
    try {
      const info = await getRainForGeometry(geometry);
      if (!info) throw new Error("Невалидна геометрия");
      setRainInfo(info);
      // Pre-fill the input with rain amount converted to m³ for the whole parcel.
      if (areaHectares && areaHectares > 0) {
        const m3 = convertWater(info.mm, areaHectares).totalM3;
        setAmount(m3.toFixed(1));
      } else {
        setAmount(String(info.mm));
      }
    } catch (e) {
      setRainError(e instanceof Error ? e.message : "Грешка при извличане на валежи");
    } finally {
      setRainLoading(false);
    }
  };

  const openRain = () => {
    setKind("rain");
    setRainInfo(null);
    setRainError(null);
    setAmount("");
    void lookupRain();
  };

  const close = () => {
    if (saving) return;
    setKind(null);
    setAmount("");
    setRainInfo(null);
    setRainError(null);
  };

  const saveRain = async () => {
    const m3 = Number(amount);
    if (!Number.isFinite(m3) || m3 < 0) {
      toast.error("Въведи валидно количество в м³");
      return;
    }
    // Convert m³ (total for parcel) → mm (depth) for DB storage.
    // 1 mm on 1 dka = 1 m³, so mm = m3_total / area_dka.
    const areaDka = areaHectares && areaHectares > 0 ? areaHectares * 10 : 1;
    const mm = m3 / areaDka;
    setSaving(true);
    try {
      // Recalculate locally so UI updates immediately — same pipeline as "Полях днес".
      const correction = recalculateAfterIrrigation(
        currentNDMI,
        mm,
        cropType,
        growthPhase,
        recommendedDoseMM,
        soilType,
      );
      const statusBefore = recommendedDoseMM <= 0 ? "green" : recommendedDoseMM < 10 ? "yellow" : "red";

      const { data: inserted, error } = await supabase
        .from("irrigation_events")
        .insert({
          parcel_id: parcelId,
          amount_mm: mm,
          dose_mm: mm,
          method: "rain",
          ndmi_before: currentNDMI,
          ndmi_after: correction.correctedNDMI,
          status_before: statusBefore,
          status_after: correction.newStatus,
          original_dose_mm: recommendedDoseMM,
          notes: rainInfo
            ? `Авто от Open-Meteo: ${rainInfo.place} (${rainInfo.lat.toFixed(3)}, ${rainInfo.lon.toFixed(3)})`
            : null,
        } as never)
        .select("id, amount_mm, dose_mm, created_at, ndmi_before, status_before, original_dose_mm")
        .single();
      if (error) throw error;

      // Persist the corrected recommendation.
      const validUntil = new Date(Date.now() + 7 * 86400_000).toISOString();
      await supabase.from("irrigation_recommendations").insert({
        parcel_id: parcelId,
        dose_mm: correction.newDose,
        status: correction.newStatus,
        reason: `Регистриран валеж ${mm.toFixed(1)}мм. ${correction.newReason}`,
        valid_until: validUntil,
        data_source: "post-rain-correction",
        confidence_pct: 85,
      });

      const placeSuffix = rainInfo ? ` (${rainInfo.place})` : "";
      await createNotification({
        title: `🌧️ Регистриран валеж`,
        body: `${parcelName}${placeSuffix}: ${m3.toFixed(1)} м³. Препоръката ще се преизчисли.`,
        kind: "irrigation",
        parcel_id: parcelId,
      });

      toast.success("Валежът е записан");
      setTodaysRain((inserted as unknown as RainEventRow) ?? null);
      onIrrigationChange?.({
        ndmi: correction.correctedNDMI,
        dose_mm: correction.newDose,
        status: correction.newStatus,
        reason: `Регистриран валеж ${mm.toFixed(1)}мм. ${correction.newReason}`,
        forecastTransform: (prev) =>
          recomputeForecast(prev, currentNDMI, correction.correctedNDMI, recommendedDoseMM),
      });
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Грешка при запис");
    } finally {
      setSaving(false);
    }
  };

  const performUndo = async () => {
    if (!todaysRain) return;
    setUndoing(true);
    try {
      const ndmiBefore = todaysRain.ndmi_before ?? currentNDMI;
      const statusBefore = todaysRain.status_before ?? "yellow";
      const origDose = todaysRain.original_dose_mm ?? recommendedDoseMM;
      const restored = reverseIrrigation(ndmiBefore, statusBefore, origDose);

      const { error: updErr } = await supabase
        .from("irrigation_events")
        .update({ undone: true, undone_at: new Date().toISOString() } as never)
        .eq("id", todaysRain.id);
      if (updErr) throw updErr;

      const validUntil = new Date(Date.now() + 7 * 86400_000).toISOString();
      await supabase.from("irrigation_recommendations").insert({
        parcel_id: parcelId,
        dose_mm: restored.restoredDose,
        status: restored.restoredStatus,
        reason: "Валежът е отменен. Върнати са оригиналните стойности.",
        valid_until: validUntil,
        data_source: "undo-correction",
        confidence_pct: 80,
      });

      toast.success("↩ Валежът е отменен успешно", { duration: 3000 });
      setTodaysRain(null);
      setConfirmUndo(false);
      onIrrigationChange?.({
        ndmi: restored.restoredNDMI,
        dose_mm: restored.restoredDose,
        status: restored.restoredStatus,
        reason: restored.restoredReason,
        forecastTransform: (prev) =>
          recomputeForecast(prev, restored.restoredNDMI, restored.restoredNDMI, restored.restoredDose),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Грешка при отмяна");
    } finally {
      setUndoing(false);
    }
  };

  return (
    <>
      {todaysRain ? (
        /* STATE 2: Rain logged today — confirmed card with undo */
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 dark:border-sky-800 dark:bg-sky-950/40 animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-2 text-sky-800 dark:text-sky-200">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm font-bold">
              Регистриран валеж в{" "}
              {new Date(todaysRain.created_at).toLocaleTimeString("bg-BG", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {(() => {
              const mmVal = todaysRain.dose_mm ?? todaysRain.amount_mm;
              const m3Val =
                areaHectares && areaHectares > 0
                  ? convertWater(mmVal, areaHectares).totalM3
                  : mmVal;
              return `${mmVal.toFixed(1)} мм · ${m3Val.toFixed(1)} м³ общо`;
            })()}
          </div>
          <div className="mt-2 flex justify-end">
            {!confirmUndo ? (
              <button
                type="button"
                onClick={() => setConfirmUndo(true)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                <Undo2 className="h-3 w-3" /> Отмени
              </button>
            ) : null}
          </div>
          {confirmUndo && (
            <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 animate-in fade-in">
              <p>Сигурен ли си? Данните ще се върнат към преди валежа.</p>
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setConfirmUndo(false)}
                  disabled={undoing}
                >
                  Не
                </Button>
                <Button
                  size="sm"
                  className="h-7 bg-amber-600 text-xs text-white hover:bg-amber-700"
                  onClick={performUndo}
                  disabled={undoing}
                >
                  {undoing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Да, отмени
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* STATE 1: default button */
        <div className="flex flex-col gap-1">
          <Button
            variant="outline"
            className="w-full border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950"
            onClick={openRain}
          >
            <CloudRain className="mr-2 h-4 w-4" />
            🌧️ Вали днес
          </Button>
          <p className="px-1 text-[10px] leading-tight text-muted-foreground">
            Авто от метео за района
          </p>
        </div>
      )}

      <Dialog open={kind !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Регистрирай валеж</DialogTitle>
            <DialogDescription>
              {parcelName} — извличаме автоматично количеството валеж за района на парцела от метео данните за днес.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            {rainLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Извличам валежи за района…
              </div>
            ) : rainError ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-destructive">{rainError}</span>
                <Button size="sm" variant="ghost" onClick={lookupRain}>
                  <RefreshCw className="mr-1 h-3 w-3" /> Опитай пак
                </Button>
              </div>
            ) : rainInfo ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  <span>{rainInfo.place}</span>
                </div>
                <div>
                  Днес в района:{" "}
                  <span className="font-semibold">
                    {rainInfo.mm > 0
                      ? areaHectares && areaHectares > 0
                        ? `${convertWater(rainInfo.mm, areaHectares).totalM3.toFixed(1)} м³ валеж`
                        : `${rainInfo.mm} mm валеж`
                      : "няма валеж"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={lookupRain}
                  className="text-xs text-primary hover:underline"
                >
                  Обнови
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2 py-2">
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1"
            />
            <span className="font-mono text-sm text-muted-foreground">м³</span>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Можеш да коригираш стойността ръчно, ако твоят дъждомер показва различно. Стойността е общо за целия парцел.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>
              Отказ
            </Button>
            <Button onClick={saveRain} disabled={saving || rainLoading}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Запиши
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
