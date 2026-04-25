import { useCallback, useEffect, useState } from "react";
import { Droplet, Loader2, Minus, Plus, CheckCircle2, History, Satellite } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { toast } from "sonner";
import {
  calculateLitersPerDecare,
  formatNextCheck,
  nextCheckDate,
  recalculateAfterIrrigation,
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
}

interface IrrigationRow {
  id: string;
  amount_mm: number;
  method: string;
  date: string;
  created_at: string;
  notes: string | null;
}

const MIN_MM = 0;
const MAX_MM = 100;

export function WateringLog({
  parcelId,
  parcelName,
  cropType,
  growthPhase,
  currentNDMI,
  recommendedDoseMM,
}: Props) {
  const defaultDose = Math.max(MIN_MM, Math.round(recommendedDoseMM || 15));
  const [open, setOpen] = useState(false);
  const [dose, setDose] = useState<number>(defaultDose);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<IrrigationRow[]>([]);

  const loadHistory = useCallback(async () => {
    const { data, error } = await supabase
      .from("irrigation_events")
      .select("id, amount_mm, method, date, created_at, notes")
      .eq("parcel_id", parcelId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (!error && data) setHistory(data as IrrigationRow[]);
  }, [parcelId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const startEdit = () => {
    setDose(defaultDose);
    setOpen(true);
    setSuccess(null);
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
      // 1. Save the irrigation event
      const { error: insertErr } = await supabase.from("irrigation_events").insert({
        parcel_id: parcelId,
        amount_mm: dose,
        method: "manual",
        notes: `Ръчно отчитане през "Полях днес"`,
      });
      if (insertErr) throw insertErr;

      // 2. Recalculate correction locally so the UI updates immediately
      const correction = recalculateAfterIrrigation(
        currentNDMI,
        dose,
        cropType,
        growthPhase,
        recommendedDoseMM,
      );

      // 3. Persist the corrected recommendation right away (the DB trigger will
      //    also fire a fuller pipeline recompute asynchronously).
      const validUntil = new Date(Date.now() + 7 * 86400_000).toISOString();
      await supabase.from("irrigation_recommendations").insert({
        parcel_id: parcelId,
        dose_mm: correction.newDose,
        status: correction.newStatus,
        reason: correction.newReason,
        valid_until: validUntil,
        data_source: "post-irrigation-correction",
        confidence_pct: 75,
      });

      await createNotification({
        title: `💧 Записано напояване — ${parcelName}`,
        body: `${dose} мм. ${correction.newReason}`,
        kind: "irrigation",
        parcel_id: parcelId,
      });

      const next = nextCheckDate(correction.nextCheckInDays);
      setSuccess(`✓ Записано! Следваща проверка ${formatNextCheck(next)} от спътника.`);
      toast.success("Записано");

      // Refresh local history
      void loadHistory();

      setTimeout(() => {
        setOpen(false);
        setSuccess(null);
      }, 3000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Грешка при запис");
    } finally {
      setSaving(false);
    }
  };

  // Status of the *current* recommendation, used for the next-check hint.
  const currentStatus: "green" | "yellow" | "red" =
    recommendedDoseMM <= 0 ? "green" : recommendedDoseMM < 10 ? "yellow" : "red";
  const statusToDays = { green: 5, yellow: 3, red: 1 } as const;
  const upcomingCheck = nextCheckDate(statusToDays[currentStatus]);

  return (
    <div className="space-y-3">
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

      {!open ? (
        <Button
          variant="outline"
          className="w-full border-blue-400 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950"
          onClick={startEdit}
        >
          <Droplet className="mr-2 h-4 w-4" />
          💧 Полях днес
        </Button>
      ) : (
        <div className="rounded-xl border-2 border-blue-300 bg-blue-50/60 p-4 dark:border-blue-800 dark:bg-blue-950/30">
          {success ? (
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-5 w-5" />
              {success}
            </div>
          ) : (
            <>
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
                {dose}mm = приблизително{" "}
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
            </>
          )}
        </div>
      )}

      {/* Watering history */}
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between text-sm">
            <span className="flex items-center gap-2">
              <History className="h-4 w-4" />
              История на напояването
              {history.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {history.length}
                </Badge>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              {historyOpen ? "Скрий" : "Покажи"}
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          {history.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-center text-xs text-muted-foreground">
              Няма записани напоявания. Натисни "Полях днес" след напояване.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((ev) => {
                const d = new Date(ev.created_at);
                const dateLbl = d.toLocaleDateString("bg-BG", {
                  day: "numeric",
                  month: "short",
                });
                const timeLbl = d.toLocaleTimeString("bg-BG", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                const isManual = ev.method === "manual";
                return (
                  <li
                    key={ev.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <Droplet
                        className={`h-4 w-4 ${isManual ? "text-blue-600" : "text-emerald-600"}`}
                      />
                      <div>
                        <div className="font-medium">
                          {dateLbl}, {timeLbl}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {ev.amount_mm.toFixed(0)}мм
                        </div>
                      </div>
                    </div>
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