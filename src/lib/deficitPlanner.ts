// Water Deficit Planner — distributes a constrained water supply across
// parcels and days based on crop priority and stress risk.
import type { CropType, GrowthPhase, MockParcel } from "./mockData";

export type Priority = "critical" | "important" | "tolerable";
export type StressRisk = "low" | "medium" | "high" | "critical";

export const CROP_PRIORITY: Record<CropType, Record<GrowthPhase, Priority>> = {
  tomatoes:  { initial: "important", development: "critical", mid: "critical",   late: "important" },
  corn:      { initial: "tolerable", development: "important", mid: "critical",  late: "important" },
  wheat:     { initial: "tolerable", development: "important", mid: "important", late: "tolerable" },
  sunflower: { initial: "tolerable", development: "tolerable", mid: "important", late: "tolerable" },
  vineyard:  { initial: "tolerable", development: "tolerable", mid: "important", late: "tolerable" },
};

export const STRESS_RISK: Record<CropType, Record<GrowthPhase, StressRisk>> = {
  tomatoes:  { mid: "critical", development: "high",   late: "medium", initial: "low" },
  corn:      { mid: "critical", development: "high",   late: "medium", initial: "low" },
  wheat:     { mid: "high",     development: "medium", late: "low",    initial: "low" },
  sunflower: { mid: "medium",   development: "low",    late: "low",    initial: "low" },
  vineyard:  { mid: "medium",   development: "low",    late: "low",    initial: "low" },
};

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, important: 1, tolerable: 2 };
const STRESS_RANK: Record<StressRisk, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface IrrigationRec {
  parcel_id: string;
  dose_mm: number;
}

export interface DeficitScheduleEntry {
  parcel_id: string;
  scheduled_date: string; // YYYY-MM-DD
  dose_mm: number;
  priority: Priority;
  crop_stress_risk: StressRisk;
}

export interface ParcelAllocation {
  parcel_id: string;
  parcel: MockParcel;
  priority: Priority;
  stress: StressRisk;
  normalDose: number;
  deficitDose: number;
  reductionPct: number;
  estimatedYieldLossPct: number;
}

export interface DeficitPlan {
  schedule: DeficitScheduleEntry[];
  allocations: ParcelAllocation[];
  totalNeeded: number;
  totalAvailable: number;
  totalScheduled: number;
  efficiencyPct: number;
  overallYieldImpactPct: number;
  days: string[];
}

function getPriority(p: MockParcel): Priority {
  return CROP_PRIORITY[p.crop_type]?.[p.growth_phase] ?? "important";
}
function getStress(p: MockParcel): StressRisk {
  return STRESS_RISK[p.crop_type]?.[p.growth_phase] ?? "medium";
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    out.push(fmtDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// Estimate yield loss based on stress risk + reduction.
function estimateYieldLoss(stress: StressRisk, reductionPct: number): number {
  const base = { critical: 0.6, high: 0.4, medium: 0.25, low: 0.12 }[stress];
  return Math.round(base * reductionPct);
}

export function calculateDeficitSchedule(
  parcels: MockParcel[],
  recommendations: IrrigationRec[],
  availablePct: number,
  dateFrom: Date,
  dateTo: Date,
): DeficitPlan {
  const days = daysBetween(dateFrom, dateTo);
  const dayCount = Math.max(1, days.length);

  // Build per-parcel info, defaulting to a sensible normal dose if missing.
  const recMap = new Map(recommendations.map((r) => [r.parcel_id, r.dose_mm]));
  const items = parcels.map((p) => {
    const priority = getPriority(p);
    const stress = getStress(p);
    const rec = recMap.get(p.id);
    const normalDose = rec !== undefined && rec > 0 ? rec : p.dose_mm > 0 ? p.dose_mm : 15;
    return { parcel: p, priority, stress, normalDose };
  });

  const totalNeeded = items.reduce((s, it) => s + it.normalDose, 0);
  const totalAvailable = totalNeeded * (availablePct / 100);

  // Sort: critical first, then by stress risk, then by larger normal dose.
  items.sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    const sr = STRESS_RANK[a.stress] - STRESS_RANK[b.stress];
    if (sr !== 0) return sr;
    return b.normalDose - a.normalDose;
  });

  // Allocate per-parcel weekly deficit dose into a working list.
  type Working = { item: typeof items[number]; dose: number };
  let remaining = totalAvailable;
  const working: Working[] = items.map((it) => ({ item: it, dose: 0 }));

  // Critical first — full dose if possible
  for (const w of working) {
    if (w.item.priority !== "critical") continue;
    const give = Math.min(w.item.normalDose, Math.max(0, remaining));
    w.dose = give;
    remaining -= give;
  }

  // Important — proportional from remaining
  const importantWs = working.filter((w) => w.item.priority === "important");
  const importantNeed = importantWs.reduce((s, w) => s + w.item.normalDose, 0);
  if (importantNeed > 0 && remaining > 0) {
    const ratio = Math.min(1, remaining / importantNeed);
    importantWs.forEach((w) => {
      const give = Math.round(w.item.normalDose * ratio * 10) / 10;
      w.dose = give;
      remaining -= give;
    });
  }

  // Tolerable — minimum 30% if we have water, else 0
  const tolerableWs = working.filter((w) => w.item.priority === "tolerable");
  const tolerableNeed = tolerableWs.reduce((s, w) => s + w.item.normalDose, 0);
  if (tolerableNeed > 0 && remaining > 0) {
    const ratio = Math.max(0.3, Math.min(1, remaining / tolerableNeed));
    tolerableWs.forEach((w) => {
      const want = w.item.normalDose * ratio;
      const give = Math.min(want, Math.max(0, remaining));
      w.dose = Math.round(give * 10) / 10;
      remaining -= w.dose;
    });
  }

  // Build the daily schedule. Spread doses across days; avoid two critical
  // parcels on the same day if possible.
  const schedule: DeficitScheduleEntry[] = [];
  working.sort((a, b) => PRIORITY_RANK[a.item.priority] - PRIORITY_RANK[b.item.priority]);
  const criticalDayUsage = new Set<string>();

  working.forEach((w) => {
    if (w.dose <= 0) return;
    const cadence = w.item.priority === "critical" ? 2 : 3;
    const events = Math.max(1, Math.min(dayCount, Math.ceil(dayCount / cadence)));
    const perEvent = Math.round((w.dose / events) * 10) / 10;
    if (perEvent <= 0) return;
    const step = dayCount / events;
    for (let i = 0; i < events; i++) {
      let idx = Math.min(dayCount - 1, Math.floor(i * step));
      if (w.item.priority === "critical") {
        let tries = 0;
        while (criticalDayUsage.has(days[idx]) && tries < dayCount) {
          idx = (idx + 1) % dayCount;
          tries++;
        }
        criticalDayUsage.add(days[idx]);
      }
      schedule.push({
        parcel_id: w.item.parcel.id,
        scheduled_date: days[idx],
        dose_mm: perEvent,
        priority: w.item.priority,
        crop_stress_risk: w.item.stress,
      });
    }
  });

  const summaries: ParcelAllocation[] = working.map((w) => {
    const reductionPct = w.item.normalDose > 0
      ? Math.round(((w.item.normalDose - w.dose) / w.item.normalDose) * 100)
      : 0;
    return {
      parcel_id: w.item.parcel.id,
      parcel: w.item.parcel,
      priority: w.item.priority,
      stress: w.item.stress,
      normalDose: Math.round(w.item.normalDose * 10) / 10,
      deficitDose: Math.round(w.dose * 10) / 10,
      reductionPct,
      estimatedYieldLossPct: estimateYieldLoss(w.item.stress, reductionPct),
    };
  });

  const totalScheduled = schedule.reduce((s, e) => s + e.dose_mm, 0);
  const efficiencyPct = totalAvailable > 0
    ? Math.min(100, Math.round((totalScheduled / totalAvailable) * 100))
    : 0;

  // Overall yield impact: weighted by normal dose share
  const totalNormal = summaries.reduce((s, a) => s + a.normalDose, 0) || 1;
  const overallYieldImpactPct = Math.round(
    summaries.reduce((s, a) => s + a.estimatedYieldLossPct * (a.normalDose / totalNormal), 0)
  );

  return {
    schedule,
    allocations: summaries,
    totalNeeded: Math.round(totalNeeded * 10) / 10,
    totalAvailable: Math.round(totalAvailable * 10) / 10,
    totalScheduled: Math.round(totalScheduled * 10) / 10,
    efficiencyPct,
    overallYieldImpactPct,
    days,
  };
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: "Критичен",
  important: "Важен",
  tolerable: "Толерантен",
};

export const PRIORITY_EMOJI: Record<Priority, string> = {
  critical: "🔴",
  important: "🟡",
  tolerable: "🟢",
};

export const STRESS_LABEL: Record<StressRisk, string> = {
  critical: "Критичен",
  high: "Висок",
  medium: "Среден",
  low: "Нисък",
};
