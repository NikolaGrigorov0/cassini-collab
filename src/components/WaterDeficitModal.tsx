// Water Deficit Modal — fermer enters how much water (in m³) they actually
// have available; the planner figures out how to split it across parcels by
// crop priority + stress risk over the chosen period.
//
// Design choices (post-2026-04 refactor):
//   • Input is m³ (real-world volume), not a percentage. The percentage is
//     shown live as derived info so the fermer can sanity-check.
//   • Period offers 3/7/14-day quick-pick chips alongside the date inputs.
//   • All preview numbers are m³ — never raw mm.
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Zap, Info } from "lucide-react";
import type { MockParcel } from "@/lib/mockData";
import { CROP_ICONS, CROP_LABELS } from "@/lib/mockData";
import {
  calculateDeficitSchedule,
  PRIORITY_EMOJI,
  PRIORITY_LABEL,
  type DeficitPlan,
} from "@/lib/deficitPlanner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  parcels: MockParcel[];
  onGenerate: (
    plan: DeficitPlan,
    params: {
      availableM3: number;
      availablePct: number;
      dateFrom: Date;
      dateTo: Date;
      parcelIds: string[];
    },
  ) => void;
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

function fmtM3(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(1)} хил. м³` : `${Math.round(v * 10) / 10} м³`;
}

const QUICK_PERIODS = [
  { days: 3, label: "3 дни" },
  { days: 7, label: "7 дни" },
  { days: 14, label: "14 дни" },
];

export function WaterDeficitModal({ open, onOpenChange, parcels, onGenerate }: Props) {
  // Period
  const today = useMemo(() => fmt(new Date()), []);
  const weekLater = useMemo(() => fmt(new Date(Date.now() + 6 * 86400000)), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(weekLater);

  // Selected parcels
  const [selectedIds, setSelectedIds] = useState<string[]>(parcels.map((p) => p.id));
  useEffect(() => {
    if (open) setSelectedIds(parcels.map((p) => p.id));
  }, [open, parcels]);

  const selectedParcels = parcels.filter((p) => selectedIds.includes(p.id));

  // Compute the total m³ need *before* the fermer enters availability so the
  // input field can be pre-filled with a sensible default (60% of need).
  const totalNeedM3 = useMemo(() => {
    if (selectedParcels.length === 0) return 0;
    const dayCount = Math.max(
      1,
      Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1,
    );
    return selectedParcels.reduce((s, p) => {
      const daily = p.dose_mm > 0 ? p.dose_mm : 4;
      return s + daily * dayCount * p.area_hectares * 10;
    }, 0);
  }, [selectedParcels, from, to]);

  // Available water (m³). Reset to a 60%-of-need default whenever the
  // total need changes, unless the fermer has already typed a custom value.
  const [availableM3, setAvailableM3] = useState<number>(0);
  const [touchedAvailable, setTouchedAvailable] = useState(false);
  useEffect(() => {
    if (!open) {
      setTouchedAvailable(false);
      return;
    }
    if (!touchedAvailable && totalNeedM3 > 0) {
      setAvailableM3(Math.round(totalNeedM3 * 0.6));
    }
  }, [open, totalNeedM3, touchedAvailable]);

  const availablePct = totalNeedM3 > 0
    ? Math.round((availableM3 / totalNeedM3) * 100)
    : 0;

  const plan = useMemo(() => {
    if (selectedParcels.length === 0 || availableM3 <= 0) return null;
    return calculateDeficitSchedule(
      selectedParcels,
      selectedParcels.map((p) => ({ parcel_id: p.id, dose_mm: p.dose_mm })),
      availableM3,
      new Date(from),
      new Date(to),
    );
  }, [selectedParcels, availableM3, from, to]);

  const severity = availablePct >= 75
    ? { label: "Лек дефицит", color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" }
    : availablePct >= 40
    ? { label: "Умерен дефицит", color: "text-amber-600", bg: "bg-amber-50 border-amber-200" }
    : { label: "Сериозен дефицит", color: "text-red-600", bg: "bg-red-50 border-red-200" };

  const toggle = (id: string) =>
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const selectAll = () => setSelectedIds(parcels.map((p) => p.id));

  const setQuickPeriod = (days: number) => {
    setFrom(today);
    setTo(fmt(new Date(Date.now() + (days - 1) * 86400000)));
  };
  const periodDays = Math.max(
    1,
    Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1,
  );
  const activeQuickDays = QUICK_PERIODS.find((q) => q.days === periodDays && from === today)?.days;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Zap className="h-5 w-5 text-amber-500" />
            Режим на воден дефицит
          </DialogTitle>
          <DialogDescription>
            Въведи колко вода имаш на разположение и системата ще раздели наличните
            кубици между парцелите по приоритет на културата.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Step 1 — period */}
          <section>
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">1</span>
              За какъв период?
            </label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_PERIODS.map((q) => (
                <button
                  key={q.days}
                  type="button"
                  onClick={() => setQuickPeriod(q.days)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    activeQuickDays === q.days
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  {q.label}
                </button>
              ))}
              <span className="ml-auto self-center text-[11px] text-muted-foreground">
                Общо <b>{periodDays}</b> дни
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">От</div>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">До</div>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          </section>

          {/* Step 2 — parcels */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">2</span>
                Кои парцели засяга?
              </label>
              <button
                type="button"
                onClick={selectAll}
                className="text-xs font-medium text-primary hover:underline"
              >
                Избери всички
              </button>
            </div>
            <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
              {parcels.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selectedIds.includes(p.id)}
                    onCheckedChange={() => toggle(p.id)}
                    id={`p-${p.id}`}
                  />
                  <label
                    htmlFor={`p-${p.id}`}
                    className="flex flex-1 cursor-pointer items-center gap-2 text-sm"
                  >
                    <span>{CROP_ICONS[p.crop_type]}</span>
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">
                      · {CROP_LABELS[p.crop_type]} · {p.area_hectares} ха
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          {/* Step 3 — available water */}
          <section>
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">3</span>
              Колко вода имаш на разположение?
            </label>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <div className="mb-1 text-xs text-muted-foreground">м³ общо</div>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={10}
                    value={availableM3 || ""}
                    onChange={(e) => {
                      setTouchedAvailable(true);
                      const v = Number(e.target.value);
                      setAvailableM3(Number.isFinite(v) && v >= 0 ? v : 0);
                    }}
                    placeholder="Напр. 5000"
                    className="text-lg font-bold"
                  />
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">от нужни</div>
                  <div className="text-lg font-bold text-foreground">{fmtM3(totalNeedM3)}</div>
                </div>
              </div>
              {totalNeedM3 > 0 && availableM3 > 0 && (
                <div className={`mt-3 flex items-center justify-between rounded-lg border px-3 py-2 ${severity.bg}`}>
                  <div>
                    <div className={`text-2xl font-bold ${severity.color}`}>{availablePct}%</div>
                    <div className={`text-xs font-medium ${severity.color}`}>{severity.label}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    Липсват{" "}
                    <b className="text-red-600">
                      {fmtM3(Math.max(0, totalNeedM3 - availableM3))}
                    </b>
                  </div>
                </div>
              )}
              <div className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  Включи всичко, което може да полееш — резервоар, помпа, кладенец.
                  Системата ще раздели по приоритет: критични култури → важни → толерантни.
                </span>
              </div>
            </div>
          </section>

          {/* Live preview */}
          {plan && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="text-sm font-semibold text-amber-900">Предварителен план</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md bg-card/60 p-2">
                  <div className="text-muted-foreground">Нужно</div>
                  <div className="text-sm font-bold">{fmtM3(plan.totalNeededM3)}</div>
                </div>
                <div className="rounded-md bg-card/60 p-2">
                  <div className="text-muted-foreground">Налично</div>
                  <div className="text-sm font-bold text-amber-700">{fmtM3(plan.totalAvailableM3)}</div>
                </div>
                <div className="rounded-md bg-card/60 p-2">
                  <div className="text-muted-foreground">Дефицит</div>
                  <div className="text-sm font-bold text-red-600">
                    {fmtM3(Math.max(0, plan.totalNeededM3 - plan.totalAvailableM3))}
                  </div>
                </div>
              </div>
              <ul className="mt-3 space-y-1.5">
                {plan.allocations.map((a) => {
                  const badgeText = a.priority === "critical"
                    ? "Пълна доза"
                    : a.deficitM3 === 0
                    ? "Пропуска се"
                    : a.priority === "important"
                    ? `Намалена с ${a.reductionPct}%`
                    : "Минимална доза";
                  const badgeClass = a.priority === "critical"
                    ? "bg-red-100 text-red-700"
                    : a.deficitM3 === 0
                    ? "bg-muted text-muted-foreground"
                    : a.priority === "important"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-emerald-100 text-emerald-700";
                  return (
                    <li
                      key={a.parcel_id}
                      className="flex items-center justify-between gap-2 rounded-md bg-card/60 px-2 py-1.5 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {PRIORITY_EMOJI[a.priority]}{" "}
                        <b>{a.parcel.name}</b>{" "}
                        <span className="text-xs text-muted-foreground">
                          · {PRIORITY_LABEL[a.priority]}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">
                          {fmtM3(a.deficitM3)} / {fmtM3(a.normalM3)}
                        </span>
                        <Badge
                          className={`${badgeClass} hover:${badgeClass}`}
                          variant="secondary"
                        >
                          {badgeText}
                        </Badge>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отказ
          </Button>
          <Button
            disabled={!plan || selectedIds.length === 0 || availableM3 <= 0}
            onClick={() => {
              if (!plan) return;
              onGenerate(plan, {
                availableM3,
                availablePct,
                dateFrom: new Date(from),
                dateTo: new Date(to),
                parcelIds: selectedIds,
              });
            }}
            className="bg-amber-500 text-white hover:bg-amber-600"
          >
            Генерирай график
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}