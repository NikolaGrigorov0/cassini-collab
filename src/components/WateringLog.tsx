import { useCallback, useEffect, useState } from "react";
import {
  Droplet, Loader2, Minus, Plus, CheckCircle2, History, Satellite, Undo2, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { toast } from "sonner";
import {
  calculateLitersPerDecare,
  formatNextCheck,
  nextCheckDate,
  recalculateAfterIrrigation,
  recomputeForecast,
  reverseIrrigation,
} from "@/lib/irrigationCorrection";

interface Props {
  parcelId: string;
  parcelName: string;
  cropType: string;
  growthPhase: string;
  /** Current NDMI reading (used as baseline for the correction). */
  currentNDMI: number;
  /** Recommended dose from the latest recommendation (mm). 0 if green. */
  recommendedDoseMM: number;
  /** Current recommendation status — needed to remember state for undo. */
  currentStatus?: "green" | "yellow" | "red";
  /** Soil type label from ISRIC enrichment (drives soil-aware NDMI lift). */
  soilType?: string | null;
  /** Called after a successful confirm/undo so the parent can patch its
   *  liveData (dose, status, reason, NDMI, forecast) and the UI reflects
   *  the new soil-moisture state immediately. */
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

interface IrrigationRow {
  id: string;
  amount_mm: number;
  dose_mm: number | null;
  method: string;
  date: string;
  created_at: string;
  irrigated_at: string | null;
  notes: string | null;
  ndmi_before: number | null;
  ndmi_after: number | null;
  status_before: string | null;
  status_after: string | null;
  original_dose_mm: number | null;
  undone: boolean;
}

const MIN_MM = 1;
const MAX_MM = 200;

const STATUS_EMOJI: Record<string, string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
};

export function WateringLog({
  parcelId,
  parcelName,
  cropType,
  growthPhase,
  currentNDMI,
  recommendedDoseMM,
  currentStatus,
  soilType,
  onIrrigationChange,
}: Props) {
  const defaultDose = Math.max(MIN_MM, Math.round(recommendedDoseMM || 15));
  const [open, setOpen] = useState(false);
  const [dose, setDose] = useState<number>(defaultDose);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<IrrigationRow[]>([]);
  const [todaysEvent, setTodaysEvent] = useState<IrrigationRow | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [undoing, setUndoing] = useState(false);

  const loadHistory = useCallback(async () => {
    const { data, error } = await supabase
      .from("irrigation_events")
      .select("id, amount_mm, dose_mm, method, date, created_at, irrigated_at, notes, ndmi_before, ndmi_after, status_before, status_after, original_dose_mm, undone")
      .eq("parcel_id", parcelId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error || !data) return;
    const rows = data as unknown as IrrigationRow[];
    setHistory(rows);
    // The most-recent non-undone manual event from today drives "state 2".
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const today = rows.find((r) =>
      !r.undone &&
      r.method === "manual" &&
      new Date(r.created_at).getTime() >= startOfDay.getTime()
    );
    setTodaysEvent(today ?? null);
  }, [parcelId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const startEdit = () => {
    setDose(defaultDose);
    setOpen(true);
  };

  const adjust = (delta: number) => {
    setDose((d) => Math.min(MAX_MM, Math.max(MIN_MM, d + delta)));
  };

  const confirm = async () => {
    if (!Number.isFinite(dose) || dose <= 0) {
      toast.error("Въведи валидна доза в мм");
      return;
    }
    setSaving(true);
    try {
      // Recalculate locally so UI updates immediately.
      const correction = recalculateAfterIrrigation(
        currentNDMI,
        dose,
        cropType,
        growthPhase,
        recommendedDoseMM,
        soilType,
      );

      const statusBefore = currentStatus
        ?? (recommendedDoseMM <= 0 ? "green" : recommendedDoseMM < 10 ? "yellow" : "red");

      // 1. Save the irrigation event with full before/after snapshot for undo.
      const { data: inserted, error: insertErr } = await supabase
        .from("irrigation_events")
        .insert({
          parcel_id: parcelId,
          amount_mm: dose,
          dose_mm: dose,
          method: "manual",
          notes: `Ръчно отчитане през "Полях днес"`,
          ndmi_before: currentNDMI,
          ndmi_after: correction.correctedNDMI,
          status_before: statusBefore,
          status_after: correction.newStatus,
          original_dose_mm: recommendedDoseMM,
        } as never)
        .select("id, amount_mm, dose_mm, method, date, created_at, irrigated_at, notes, ndmi_before, ndmi_after, status_before, status_after, original_dose_mm, undone")
        .single();
      if (insertErr) throw insertErr;

      // 2. Persist the corrected recommendation (DB trigger also fires async pipeline).
      const validUntil = new Date(Date.now() + 7 * 86400_000).toISOString();
      await supabase.from("irrigation_recommendations").insert({
        parcel_id: parcelId,
        dose_mm: correction.newDose,
        status: correction.newStatus,
        reason: correction.newReason,
        valid_until: validUntil,
        data_source: "post-irrigation-correction",
        confidence_pct: 85,
      });

      await createNotification({
        title: `💧 Записано напояване — ${parcelName}`,
        body: `${dose} мм. ${correction.newReason}`,
        kind: "irrigation",
        parcel_id: parcelId,
      });

      toast.success("Записано");
      setOpen(false);
      setTodaysEvent((inserted as unknown as IrrigationRow) ?? null);
      void loadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Грешка при запис");
    } finally {
      setSaving(false);
    }
  };

  const performUndo = async () => {
    if (!todaysEvent) return;
    setUndoing(true);
    try {
      const ndmiBefore = todaysEvent.ndmi_before ?? currentNDMI;
      const statusBefore = todaysEvent.status_before ?? "yellow";
      const origDose = todaysEvent.original_dose_mm ?? recommendedDoseMM;
      const restored = reverseIrrigation(ndmiBefore, statusBefore, origDose);

      // 1. Mark event as undone
      const { error: updErr } = await supabase
        .from("irrigation_events")
        .update({ undone: true, undone_at: new Date().toISOString() } as never)
        .eq("id", todaysEvent.id);
      if (updErr) throw updErr;

      // 2. Restore recommendation
      const validUntil = new Date(Date.now() + 7 * 86400_000).toISOString();
      await supabase.from("irrigation_recommendations").insert({
        parcel_id: parcelId,
        dose_mm: restored.restoredDose,
        status: restored.restoredStatus,
        reason: restored.restoredReason,
        valid_until: validUntil,
        data_source: "undo-correction",
        confidence_pct: 80,
      });

      toast.success("↩ Напояването е отменено успешно", { duration: 3000 });
      setTodaysEvent(null);
      setConfirmUndo(false);
      void loadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Грешка при отмяна");
    } finally {
      setUndoing(false);
    }
  };

  // Status of the *current* recommendation, used for the next-check hint.
  const effectiveStatus: "green" | "yellow" | "red" =
    (todaysEvent?.status_after as "green" | "yellow" | "red" | undefined)
    ?? currentStatus
    ?? (recommendedDoseMM <= 0 ? "green" : recommendedDoseMM < 10 ? "yellow" : "red");
  const statusToDays = { green: 5, yellow: 3, red: 1 } as const;
  const upcomingCheck = nextCheckDate(statusToDays[effectiveStatus]);

  return (
    <div className="space-y-3">
      {/* STATE 2: watered today — confirmed card with undo */}
      {todaysEvent ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/40 animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm font-bold">
              Полято днес в{" "}
              {new Date(todaysEvent.created_at).toLocaleTimeString("bg-BG", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Доза: {(todaysEvent.dose_mm ?? todaysEvent.amount_mm).toFixed(0)}мм ·{" "}
            {calculateLitersPerDecare(todaysEvent.dose_mm ?? todaysEvent.amount_mm).toLocaleString("bg-BG")} литра на декар
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
              <p>Сигурен ли си? Данните ще се върнат към преди напояването.</p>
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
      ) : !open ? (
        /* STATE 1: default button */
        <Button
          variant="outline"
          className="w-full border-blue-400 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950"
          onClick={startEdit}
        >
          <Droplet className="mr-2 h-4 w-4" />
          💧 Полях днес
        </Button>
      ) : (
        /* INLINE FORM */
        <div className="rounded-xl border-2 border-blue-300 bg-blue-50/60 p-4 dark:border-blue-800 dark:bg-blue-950/30 animate-in fade-in slide-in-from-top-1">
          <label className="text-sm font-semibold text-blue-900 dark:text-blue-200">
            Колко мм напои?
          </label>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() => adjust(-5)}
              disabled={saving || dose <= MIN_MM}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              type="number"
              inputMode="decimal"
              step="1"
              min={MIN_MM}
              max={MAX_MM}
              value={dose}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setDose(Math.min(MAX_MM, Math.max(MIN_MM, v)));
              }}
              className="text-center text-lg font-bold"
            />
            <span className="font-mono text-sm text-muted-foreground">мм</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() => adjust(5)}
              disabled={saving || dose >= MAX_MM}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {dose}mm ≈{" "}
            <span className="font-semibold text-foreground">
              {calculateLitersPerDecare(dose).toLocaleString("bg-BG")} литра
            </span>{" "}
            на декар
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Отказ
            </Button>
            <Button
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={confirm}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Потвърди
            </Button>
          </div>
        </div>
      )}

      {/* Next-satellite-check hint */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Satellite className="h-3.5 w-3.5 text-primary" />
        <span>
          📡 Следваща спътникова проверка:{" "}
          <span className="font-semibold text-foreground">
            {formatNextCheck(upcomingCheck)}
          </span>
        </span>
      </div>

      {/* Watering history */}
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between text-sm">
            <span className="flex items-center gap-2">
              <History className="h-4 w-4" />
              История на напояването
              {history.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {history.filter((h) => !h.undone).length}
                </Badge>
              )}
            </span>
            <ChevronDown className={`h-4 w-4 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 animate-in slide-in-from-top-1">
          {history.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-center text-xs text-muted-foreground">
              Няма записани напоявания. Натисни "Полях днес" след напояване.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.slice(0, 5).map((ev) => {
                const d = new Date(ev.created_at);
                const dateLbl = d.toLocaleDateString("bg-BG", {
                  day: "numeric",
                  month: "short",
                });
                const timeLbl = d.toLocaleTimeString("bg-BG", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                const mm = ev.dose_mm ?? ev.amount_mm;
                const liters = calculateLitersPerDecare(mm).toLocaleString("bg-BG");
                const isManual = ev.method === "manual";
                const sBefore = ev.status_before ? STATUS_EMOJI[ev.status_before] : null;
                const sAfter = ev.status_after ? STATUS_EMOJI[ev.status_after] : null;
                return (
                  <li
                    key={ev.id}
                    className={`rounded-lg border border-border bg-card px-3 py-2 text-sm ${ev.undone ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <Droplet
                          className={`mt-0.5 h-4 w-4 ${isManual ? "text-blue-600" : "text-emerald-600"}`}
                        />
                        <div>
                          <div className={`font-medium ${ev.undone ? "line-through" : ""}`}>
                            {dateLbl}, {timeLbl}
                          </div>
                          <div className={`text-xs text-muted-foreground ${ev.undone ? "line-through" : ""}`}>
                            {mm.toFixed(0)}мм · {liters} л/дка
                          </div>
                          {(ev.ndmi_before != null && ev.ndmi_after != null) && (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              NDMI: {ev.ndmi_before.toFixed(2)} → {ev.ndmi_after.toFixed(2)}
                              {sBefore && sAfter && (
                                <span className="ml-2">{sBefore} → {sAfter}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {ev.undone ? (
                        <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
                          Отменено
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className={
                            isManual
                              ? "border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300"
                              : "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
                          }
                        >
                          {isManual ? "Ръчно" : ev.method === "rain" ? "Валеж" : "Препоръчано"}
                        </Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
