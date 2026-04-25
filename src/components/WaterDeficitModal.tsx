import { useMemo, useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";
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
  onGenerate: (plan: DeficitPlan, params: {
    availablePct: number;
    dateFrom: Date;
    dateTo: Date;
    parcelIds: string[];
  }) => void;
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function WaterDeficitModal({ open, onOpenChange, parcels, onGenerate }: Props) {
  const [pct, setPct] = useState(60);
  const today = useMemo(() => fmt(new Date()), []);
  const weekLater = useMemo(() => fmt(new Date(Date.now() + 7 * 86400000)), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(weekLater);
  const [selectedIds, setSelectedIds] = useState<string[]>(parcels.map((p) => p.id));

  useEffect(() => {
    if (open) setSelectedIds(parcels.map((p) => p.id));
  }, [open, parcels]);

  const selectedParcels = parcels.filter((p) => selectedIds.includes(p.id));

  const plan = useMemo(() => {
    if (selectedParcels.length === 0) return null;
    return calculateDeficitSchedule(
      selectedParcels,
      selectedParcels.map((p) => ({ parcel_id: p.id, dose_mm: p.dose_mm })),
      pct,
      new Date(from),
      new Date(to),
    );
  }, [selectedParcels, pct, from, to]);

  const severityLabel =
    pct >= 75 ? "Лек дефицит" : pct >= 40 ? "Умерен дефицит" : "Сериозен дефицит";
  const severityColor =
    pct >= 75 ? "text-emerald-600" : pct >= 40 ? "text-amber-600" : "text-red-600";

  const toggle = (id: string) =>
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const selectAll = () => setSelectedIds(parcels.map((p) => p.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Zap className="h-5 w-5 text-amber-500" />
            Режим на воден дефицит
          </DialogTitle>
          <DialogDescription>
            Въведи наличното количество вода и ще изчислим оптимален график
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Slider */}
          <section>
            <label className="mb-2 block text-sm font-semibold">Налично количество вода</label>
            <div className="text-center">
              <span className={`text-5xl font-bold ${severityColor}`}>{pct}%</span>
              <div className={`mt-1 text-sm font-medium ${severityColor}`}>{severityLabel}</div>
            </div>
            <Slider
              value={[pct]}
              onValueChange={(v) => setPct(v[0] ?? 60)}
              min={10}
              max={90}
              step={5}
              className="mt-4"
            />
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
              <div className="rounded-md bg-emerald-50 p-2 text-center">
                <div className="font-bold text-emerald-700">75–90%</div>
                Лек дефицит — малки корекции
              </div>
              <div className="rounded-md bg-amber-50 p-2 text-center">
                <div className="font-bold text-amber-700">40–74%</div>
                Умерен — приоритизиране
              </div>
              <div className="rounded-md bg-red-50 p-2 text-center">
                <div className="font-bold text-red-700">10–39%</div>
                Сериозен — спасяване на реколтата
              </div>
            </div>
          </section>

          {/* Period */}
          <section>
            <label className="mb-2 block text-sm font-semibold">Период на дефицит</label>
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

          {/* Parcels */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-semibold">Засегнати парцели</label>
              <button
                type="button"
                onClick={selectAll}
                className="text-xs font-medium text-primary hover:underline"
              >
                Избери всички
              </button>
            </div>
            <ul className="space-y-1.5 rounded-md border border-border p-2 max-h-40 overflow-y-auto">
              {parcels.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50">
                  <Checkbox
                    checked={selectedIds.includes(p.id)}
                    onCheckedChange={() => toggle(p.id)}
                    id={`p-${p.id}`}
                  />
                  <label htmlFor={`p-${p.id}`} className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                    <span>{CROP_ICONS[p.crop_type]}</span>
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">· {CROP_LABELS[p.crop_type]}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          {/* Live preview */}
          {plan && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="text-sm font-semibold text-amber-900">Предварителен преглед</div>
              <div className="mt-2 text-sm">
                Обща нужда: <b>{plan.totalNeeded}mm</b> → Налично:{" "}
                <b className="text-amber-700">{plan.totalAvailable}mm</b> → Дефицит:{" "}
                <b className="text-red-600">
                  {Math.round((plan.totalNeeded - plan.totalAvailable) * 10) / 10}mm
                </b>
              </div>
              <ul className="mt-3 space-y-1.5">
                {plan.allocations.map((a) => {
                  const badgeText =
                    a.priority === "critical"
                      ? "Пълна доза"
                      : a.deficitDose === 0
                      ? "Пропуска се"
                      : a.priority === "important"
                      ? `Намалена доза ${a.reductionPct}%`
                      : "Минимална доза";
                  const badgeClass =
                    a.priority === "critical"
                      ? "bg-red-100 text-red-700"
                      : a.priority === "important"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-emerald-100 text-emerald-700";
                  return (
                    <li key={a.parcel_id} className="flex items-center justify-between text-sm">
                      <span>
                        {PRIORITY_EMOJI[a.priority]} <b>{a.parcel.name}</b>{" "}
                        <span className="text-xs text-muted-foreground">
                          · {PRIORITY_LABEL[a.priority]}
                        </span>
                      </span>
                      <Badge className={`${badgeClass} hover:${badgeClass}`} variant="secondary">
                        {badgeText}
                      </Badge>
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
            disabled={!plan || selectedIds.length === 0}
            onClick={() => {
              if (!plan) return;
              onGenerate(plan, {
                availablePct: pct,
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
