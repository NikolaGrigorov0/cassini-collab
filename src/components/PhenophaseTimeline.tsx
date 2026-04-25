import { useEffect, useState } from "react";
import { Sprout, Loader2, Pencil, RotateCcw, AlertTriangle, Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import {
  fetchPhenophases,
  getPhasesForCrop,
  pickPhaseForDays,
  daysSince,
  daysUntilNextPhase,
  phaseProgressPct,
  adjustKc,
  syncAutoPhase,
  setManualPhase,
  clearManualOverride,
  phaseEmoji,
  type Phenophase,
  type ParcelGrowthRow,
} from "@/lib/phenophases";

interface Props {
  parcelId: string;
  cropType: string;
  /** Sowing date as ISO string (YYYY-MM-DD) or null. */
  sowingDate?: string | null;
  ndvi?: number | null;
  /** Open the parcel-edit modal so the farmer can fill in the sowing date. */
  onEditDetails?: () => void;
}

export function PhenophaseTimeline({ parcelId, cropType, sowingDate, ndvi, onEditDetails }: Props) {
  const [phases, setPhases] = useState<Phenophase[] | null>(null);
  const [growth, setGrowth] = useState<ParcelGrowthRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const sowing = sowingDate ? new Date(sowingDate) : null;

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await fetchPhenophases();
      const cropPhases = getPhasesForCrop(all, cropType);
      if (cropPhases.length === 0) {
        console.warn(
          `[PhenophaseTimeline] No phases found for crop_type="${cropType}". ` +
            `Available: ${[...new Set(all.map((p) => p.crop_type))].join(", ")}`,
        );
      }
      setPhases(cropPhases);
      const { row } = await syncAutoPhase(parcelId, cropType, sowing);
      setGrowth(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Грешка");
    } finally {
      setLoading(false);
    }
  };

  // Clear stale phases immediately when the crop changes, so the previous
  // crop's timeline never flashes while new data is loading.
  useEffect(() => {
    setPhases(null);
    setGrowth(null);
  }, [cropType, parcelId]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelId, cropType, sowingDate]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Зареждам фенофази…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground">
        Не можах да заредя фенофазите: {error}
      </div>
    );
  }
  if (!phases || phases.length === 0) return null;

  // Empty state — no sowing date AND no manual override
  if (!sowing && !growth?.is_manual_override) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-900">
              Въведи дата на засяване
            </div>
            <p className="mt-0.5 text-xs text-amber-800">
              За да активираш следенето на фенофазите, добави датата на засяване в детайлите на парцела.
            </p>
          </div>
          {onEditDetails && (
            <Button
              size="sm"
              variant="outline"
              onClick={onEditDetails}
              className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
            >
              <Pencil className="mr-1 h-3 w-3" /> Добави
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Determine current phase index
  const days = sowing ? daysSince(sowing) : 0;
  const auto = pickPhaseForDays(phases, days);
  const currentPhase: Phenophase | null = growth?.is_manual_override
    ? phases.find((p) => p.id === growth.current_phase_id) ?? auto.phase
    : auto.phase;
  const currentIndex = currentPhase
    ? phases.findIndex((p) => p.id === currentPhase.id)
    : auto.index;

  const start = currentPhase?.days_from_sowing_start ?? 0;
  const end = currentPhase?.days_from_sowing_end ?? start + (currentPhase?.typical_duration_days ?? 0);
  const totalDays = end - start;
  const dayInPhase = sowing && !growth?.is_manual_override
    ? Math.max(0, Math.min(totalDays, days - start))
    : 0;
  const progress = phaseProgressPct(dayInPhase, totalDays);

  const nextDays = sowing && !growth?.is_manual_override
    ? daysUntilNextPhase(phases, days)
    : null;

  const kcAdj = currentPhase ? adjustKc(currentPhase.kc_base, ndvi ?? null) : 0;

  const handleSetManual = async (phaseId: string) => {
    setBusy(true);
    try {
      const row = await setManualPhase(parcelId, phaseId);
      setGrowth(row);
      setPickerOpen(false);
      toast.success("Фазата е променена ръчно");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Грешка");
    } finally {
      setBusy(false);
    }
  };

  const handleClearOverride = async () => {
    setBusy(true);
    try {
      await clearManualOverride(parcelId);
      const { row } = await syncAutoPhase(parcelId, cropType, sowing);
      setGrowth(row);
      toast.success("Върнато на автоматично");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Грешка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sprout className="h-4 w-4 text-emerald-600" />
          <h3 className="text-sm font-semibold">Фенофаза</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {growth?.is_manual_override && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              Ръчно зададена
            </span>
          )}
          {currentPhase?.is_critical && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
              ⚠ Критичен период
            </span>
          )}
        </div>
      </div>

      {/* Horizontal sub-phase timeline */}
      <div className="mb-3 overflow-x-auto pb-2">
        <div className="flex min-w-max items-center gap-1">
          {phases.map((p, i) => {
            const isPast = i < currentIndex;
            const isCurrent = i === currentIndex;
            return (
              <div key={p.id} className="flex items-center">
                <div
                  className={`flex min-w-[88px] flex-col items-center rounded-lg border px-2 py-1.5 text-center transition ${
                    isCurrent
                      ? "border-emerald-500 bg-emerald-50 shadow-sm"
                      : isPast
                        ? "border-gray-200 bg-gray-50 opacity-70"
                        : "border-dashed border-gray-200 bg-card opacity-60"
                  }`}
                  title={p.description ?? p.phase_name}
                >
                  <div className={`text-base ${isCurrent ? "" : "grayscale"}`}>
                    {phaseEmoji(p.order_index, phases.length)}
                  </div>
                  <div
                    className={`mt-0.5 truncate text-[10px] font-medium leading-tight ${
                      isCurrent
                        ? "text-emerald-800"
                        : isPast
                          ? "text-gray-500"
                          : "text-gray-400"
                    }`}
                  >
                    {p.phase_name}
                  </div>
                  {isPast && <Check className="mt-0.5 h-2.5 w-2.5 text-gray-400" />}
                  {isCurrent && (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-emerald-100">
                      <div
                        className="h-full bg-emerald-500 transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </div>
                {i < phases.length - 1 && (
                  <ChevronRight
                    className={`mx-0.5 h-3 w-3 shrink-0 ${
                      i < currentIndex ? "text-emerald-400" : "text-gray-300"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Active phase info */}
      {currentPhase && (
        <div className="rounded-xl bg-emerald-50/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-emerald-900">
                {currentPhase.phase_name}
              </div>
              {currentPhase.description && (
                <p className="mt-0.5 text-xs text-emerald-800/80">
                  {currentPhase.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-emerald-900/80">
                {!growth?.is_manual_override && totalDays > 0 && (
                  <span>
                    Ден <b>{dayInPhase}</b> от ~<b>{totalDays}</b>
                  </span>
                )}
                <span>
                  Kc базов: <b>{currentPhase.kc_base.toFixed(2)}</b>
                </span>
                <span>
                  Kc по NDVI: <b>{kcAdj.toFixed(2)}</b>
                </span>
                <span>
                  MAD праг: <b>{Math.round(currentPhase.mad_threshold * 100)}%</b>
                </span>
              </div>
              {nextDays !== null && nextDays > 0 && (
                <p className="mt-1.5 text-[11px] text-emerald-700">
                  Очаквана следваща фаза след ~<b>{nextDays}</b> {nextDays === 1 ? "ден" : "дни"}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex shrink-0 flex-col gap-1">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 text-xs">
                    <Pencil className="mr-1 h-3 w-3" /> Промени
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 pointer-events-auto" align="end">
                  <div className="text-xs font-semibold mb-2">Избери фаза ръчно</div>
                  <Select
                    value={currentPhase.id}
                    onValueChange={(v) => void handleSetManual(v)}
                    disabled={busy}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {phases.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.order_index}. {p.phase_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Ръчният избор спира автоматичното превключване по дни.
                  </p>
                </PopoverContent>
              </Popover>
              {growth?.is_manual_override && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-emerald-700 hover:bg-emerald-100"
                  onClick={() => void handleClearOverride()}
                  disabled={busy}
                >
                  <RotateCcw className="mr-1 h-3 w-3" /> Авто
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="mt-3 text-[10px] text-muted-foreground">
        Динамичен Kc = 1.25 × NDVI + 0.2 (FAO-56). Влияе на дозата напояване.
      </p>
    </div>
  );
}