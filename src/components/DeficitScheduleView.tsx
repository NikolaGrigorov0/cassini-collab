import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import type { MockParcel } from "@/lib/mockData";
import { CROP_ICONS, CROP_LABELS } from "@/lib/mockData";
import {
  PRIORITY_EMOJI,
  type DeficitPlan,
} from "@/lib/deficitPlanner";

interface Props {
  plan: DeficitPlan;
  parcels: MockParcel[];
  availablePct: number;
  dateFrom: Date;
  dateTo: Date;
  onBack: () => void;
}

function stressBadgeClass(s: string) {
  return s === "critical"
    ? "bg-red-100 text-red-700"
    : s === "high"
    ? "bg-orange-100 text-orange-700"
    : s === "medium"
    ? "bg-amber-100 text-amber-700"
    : "bg-emerald-100 text-emerald-700";
}

function fmtM3(v: number): string {
  if (v <= 0) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(1)} хил.` : `${Math.round(v * 10) / 10}`;
}

export function DeficitScheduleView({ plan, parcels, availablePct, dateFrom, dateTo, onBack }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "bg" ? "bg-BG" : "en-US";
  const dayLabel = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  };
  const PRIORITY_LABEL_T: Record<string, string> = {
    critical: t("deficit.priorityCritical"),
    important: t("deficit.priorityImportant"),
    tolerable: t("deficit.priorityTolerable"),
  };
  const STRESS_LABEL_T: Record<string, string> = {
    critical: t("deficit.stressCritical"),
    high: t("deficit.stressHigh"),
    medium: t("deficit.stressMedium"),
    low: t("deficit.stressLow"),
  };
  const parcelMap = new Map(parcels.map((p) => [p.id, p]));
  const allocs = plan.allocations.filter((a) => parcelMap.has(a.parcel_id));

  // Build day → parcel → dose lookup
  const grid = new Map<string, Map<string, number>>();
  plan.schedule.forEach((s) => {
    if (!grid.has(s.parcel_id)) grid.set(s.parcel_id, new Map());
    const m = grid.get(s.parcel_id)!;
    m.set(s.scheduled_date, (m.get(s.scheduled_date) ?? 0) + s.dose_m3);
  });

  const dayTotals = plan.days.map((d) => {
    let t = 0;
    plan.schedule.forEach((s) => {
      if (s.scheduled_date === d) t += s.dose_m3;
    });
    return Math.round(t * 10) / 10;
  });

  const cellColor = (dose: number, allocPriority: string, stress: string): string => {
    if (dose === 0) return "bg-muted/40 text-muted-foreground";
    if (allocPriority === "critical") return "bg-red-100 text-red-800 border-red-300";
    if (stress === "high" || stress === "medium") return "bg-amber-100 text-amber-800 border-amber-300";
    return "bg-emerald-100 text-emerald-800 border-emerald-300";
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label={t("deficit.back")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">{t("deficit.title")}</h1>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        <span className="font-bold">{t("deficit.modeActive")}</span>
        <span>·</span>
        <span>{availablePct}{t("deficit.ofNormal")}</span>
        <span>·</span>
        <span>
          {dateFrom.toLocaleDateString(locale)} — {dateTo.toLocaleDateString(locale)}
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Calendar grid */}
        <main className="flex-1 overflow-auto p-4">
          <div className="rounded-xl border border-border bg-card shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="sticky left-0 z-10 bg-muted/50 p-3 text-left font-semibold">{t("deficit.field")}</th>
                    {plan.days.map((d) => (
                      <th key={d} className="p-2 text-center text-xs font-semibold">
                        {dayLabel(d)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allocs.map((a) => {
                    const row = grid.get(a.parcel_id) ?? new Map<string, number>();
                    return (
                      <tr key={a.parcel_id} className="border-t border-border">
                        <td className="sticky left-0 z-10 bg-card p-3">
                          <div className="flex items-center gap-2">
                            <span>{CROP_ICONS[a.parcel.crop_type]}</span>
                            <div>
                              <div className="font-medium">{a.parcel.name}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {PRIORITY_EMOJI[a.priority]} {PRIORITY_LABEL_T[a.priority]}
                              </div>
                            </div>
                          </div>
                        </td>
                        {plan.days.map((d) => {
                          const dose = row.get(d) ?? 0;
                          const cls = cellColor(dose, a.priority, a.stress);
                          const isCriticalWarn = dose > 0 && a.priority === "critical";
                          return (
                            <td key={d} className="p-1.5 text-center">
                              <div className={`rounded-md border px-1 py-2 text-xs font-bold ${cls}`}>
                                {dose > 0 ? (
                                  <>
                                    {isCriticalWarn && <span className="mr-0.5">⚠</span>}
                                    {fmtM3(dose)} {t("units.m3")}
                                  </>
                                ) : (
                                  "—"
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-border bg-muted/30">
                    <td className="sticky left-0 z-10 bg-muted/30 p-3 font-semibold">{t("deficit.dayTotal")}</td>
                    {dayTotals.map((tot, i) => (
                      <td key={i} className="p-2 text-center text-xs font-bold">
                        {fmtM3(tot)} {t("units.m3")}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </main>

        {/* Sidebar */}
        <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-l border-border bg-card p-4 lg:block">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            {t("deficit.result")}
          </h2>
          <ul className="space-y-3">
            {allocs.map((a) => (
              <li key={a.parcel_id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-medium">
                    {CROP_ICONS[a.parcel.crop_type]} {a.parcel.name}
                  </span>
                  <span className="text-lg">{PRIORITY_EMOJI[a.priority]}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t(`crops.${a.parcel.crop_type}`, { defaultValue: CROP_LABELS[a.parcel.crop_type] })}
                </div>
                <div className="mt-2 text-sm">
                  {t("deficit.needs")} <b>{fmtM3(a.normalM3)} {t("units.m3")}</b> → {t("deficit.willGet")}{" "}
                  <b className="text-amber-700">{fmtM3(a.deficitM3)} {t("units.m3")}</b>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {t("deficit.perDayLine", { mm: a.dailyDoseMm, days: plan.days.length, ha: a.parcel.area_hectares })}
                </div>
                <div className="mt-1 text-xs">
                  {t("deficit.expectedLoss")}{" "}
                  <b
                    className={
                      a.estimatedYieldLossPct > 25
                        ? "text-red-600"
                        : a.estimatedYieldLossPct > 10
                        ? "text-amber-600"
                        : "text-emerald-600"
                    }
                  >
                    ~{a.estimatedYieldLossPct}%
                  </b>
                </div>
                <div className="mt-2">
                  <Badge variant="secondary" className={stressBadgeClass(a.stress)}>
                    {t("deficit.stress")} {STRESS_LABEL_T[a.stress]}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
            <div>
              {t("deficit.totalAlloc")} <b>{fmtM3(plan.totalScheduledM3)} {t("units.m3")}</b> {t("deficit.of")}{" "}
              {fmtM3(plan.totalAvailableM3)} {t("units.m3")} {t("deficit.available")}{" "}
              <span className="text-amber-700">({plan.efficiencyPct}% {t("deficit.efficiency")})</span>
            </div>
            <div>
              {t("deficit.totalYieldImpact")}{" "}
              <b className="text-amber-700">~{plan.overallYieldImpactPct}%</b>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
