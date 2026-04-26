// Water Deficit Planner — distributes a constrained water supply across
// parcels and days based on crop priority and stress risk.
//
// Units rationale (post-refactor):
//   • Inputs `recommendations[].dose_mm` are DAILY doses in mm
//     (matches IrrigationCard "today" box and dashboard sidebar number).
//   • The planner expands daily mm × period days × parcel area_ha × 10
//     into a TOTAL VOLUME IN m³ per parcel for the whole period —
//     the unit fermers actually understand.
//   • All allocation/scheduling math is done in m³.
//   • `availableM3` is the literal cubic-metres the fermer has on hand
//     (e.g. reservoir capacity); we no longer take a raw percentage.
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
  /** Daily ETc-based dose in mm (what the parcel needs *per day*). */
  dose_mm: number;
}

export interface DeficitScheduleEntry {
  parcel_id: string;
  scheduled_date: string; // YYYY-MM-DD
  /** Per-event volume in m³ for this parcel on this day. */
  dose_m3: number;
  priority: Priority;
  crop_stress_risk: StressRisk;
}

export interface ParcelAllocation {
  parcel_id: string;
  parcel: MockParcel;
  priority: Priority;
  stress: StressRisk;
  /** Total volume the parcel *normally* needs over the period (m³). */
  normalM3: number;
  /** Volume the parcel will actually receive under the deficit plan (m³). */
  deficitM3: number;
  /** Daily dose used to derive normalM3 (kept for tooltips). */
  dailyDoseMm: number;
  reductionPct: number;
  estimatedYieldLossPct: number;
}

export interface DeficitPlan {
  schedule: DeficitScheduleEntry[];
  allocations: ParcelAllocation[];
  /** Sum of all parcels' normal need over the period (m³). */
  totalNeededM3: number;
  /** Available water entered by the fermer (m³). Capped at totalNeededM3 for display. */
  totalAvailableM3: number;
  /** Sum of all scheduled events (m³). */
  totalScheduledM3: number;
  /** Available as a percentage of need — derived for UI labels. */
  availablePct: number;
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
  availableM3: number,
  dateFrom: Date,
  dateTo: Date,
): DeficitPlan {
  const days = daysBetween(dateFrom, dateTo);
  const dayCount = Math.max(1, days.length);

  // Build per-parcel info using DAILY mm × days × area to get total m³ needed.
  // Fallback: if no recommendation, assume 4 mm/day (typical mid-season ETc).
  const recMap = new Map(recommendations.map((r) => [r.parcel_id, r.dose_mm]));
  const items = parcels.map((p) => {
    const priority = getPriority(p);
    const stress = getStress(p);
    const rec = recMap.get(p.id);
    const dailyDoseMm = rec !== undefined && rec > 0 ? rec : p.dose_mm > 0 ? p.dose_mm : 4;
    const areaDka = Math.max(0, p.area_hectares) * 10;
    // 1 mm of irrigation depth on 1 dka = 1 m³ of water.
    const normalM3 = dailyDoseMm * dayCount * areaDka;
    return { parcel: p, priority, stress, dailyDoseMm, normalM3, areaDka };
  });

  const totalNeededM3 = items.reduce((s, it) => s + it.normalM3, 0);
  const totalAvailableM3 = Math.max(0, availableM3);
  const availablePct = totalNeededM3 > 0
    ? Math.round((totalAvailableM3 / totalNeededM3) * 100)
    : 100;

  // Sort: critical first, then by stress risk, then by larger normal dose.
  items.sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    const sr = STRESS_RANK[a.stress] - STRESS_RANK[b.stress];
    if (sr !== 0) return sr;
    return b.normalM3 - a.normalM3;
  });

  // Allocate per-parcel volume (m³) over the whole period.
  type Working = { item: typeof items[number]; m3: number };
  let remaining = totalAvailableM3;
  const working: Working[] = items.map((it) => ({ item: it, dose: 0 }));

  // Critical first — full dose if possible
  for (const w of working) {
    if (w.item.priority !== "critical") continue;
    const give = Math.min(w.item.normalM3, Math.max(0, remaining));
    w.m3 = give;
    remaining -= give;
  }

  // Important — proportional from remaining
  const importantWs = working.filter((w) => w.item.priority === "important");
  const importantNeed = importantWs.reduce((s, w) => s + w.item.normalM3, 0);
  if (importantNeed > 0 && remaining > 0) {
    const ratio = Math.min(1, remaining / importantNeed);
    importantWs.forEach((w) => {
      const give = Math.round(w.item.normalM3 * ratio * 10) / 10;
      w.m3 = give;
      remaining -= give;
    });
  }

  // Tolerable — minimum 30% if we have water, else 0
  const tolerableWs = working.filter((w) => w.item.priority === "tolerable");
  const tolerableNeed = tolerableWs.reduce((s, w) => s + w.item.normalM3, 0);
  if (tolerableNeed > 0 && remaining > 0) {
    const ratio = Math.max(0.3, Math.min(1, remaining / tolerableNeed));
    tolerableWs.forEach((w) => {
      const want = w.item.normalM3 * ratio;
      const give = Math.min(want, Math.max(0, remaining));
      w.m3 = Math.round(give * 10) / 10;
      remaining -= w.m3;
    });
  }

  // Build the daily schedule. Spread total m³ across irrigation events,
  // avoiding clustering critical parcels on the same day when possible.
  const schedule: DeficitScheduleEntry[] = [];
  working.sort((a, b) => PRIORITY_RANK[a.item.priority] - PRIORITY_RANK[b.item.priority]);
  const criticalDayUsage = new Set<string>();

  working.forEach((w) => {
    if (w.m3 <= 0) return;
    const cadence = w.item.priority === "critical" ? 2 : 3;
    const events = Math.max(1, Math.min(dayCount, Math.ceil(dayCount / cadence)));
    const perEvent = Math.round((w.m3 / events) * 10) / 10;
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
        dose_m3: perEvent,
        priority: w.item.priority,
        crop_stress_risk: w.item.stress,
      });
    }
  });

  const summaries: ParcelAllocation[] = working.map((w) => {
    const reductionPct = w.item.normalM3 > 0
      ? Math.round(((w.item.normalM3 - w.m3) / w.item.normalM3) * 100)
      : 0;
    return {
      parcel_id: w.item.parcel.id,
      parcel: w.item.parcel,
      priority: w.item.priority,
      stress: w.item.stress,
      normalM3: Math.round(w.item.normalM3 * 10) / 10,
      deficitM3: Math.round(w.m3 * 10) / 10,
      dailyDoseMm: Math.round(w.item.dailyDoseMm * 10) / 10,
      reductionPct,
      estimatedYieldLossPct: estimateYieldLoss(w.item.stress, reductionPct),
    };
  });

  const totalScheduledM3 = schedule.reduce((s, e) => s + e.dose_m3, 0);
  const efficiencyPct = totalAvailableM3 > 0
    ? Math.min(100, Math.round((totalScheduledM3 / totalAvailableM3) * 100))
    : 0;

  // Overall yield impact: weighted by normal dose share
  const totalNormal = summaries.reduce((s, a) => s + a.normalM3, 0) || 1;
  const overallYieldImpactPct = Math.round(
    summaries.reduce((s, a) => s + a.estimatedYieldLossPct * (a.normalM3 / totalNormal), 0)
  );

  return {
    schedule,
    allocations: summaries,
    totalNeededM3: Math.round(totalNeededM3 * 10) / 10,
    totalAvailableM3: Math.round(totalAvailableM3 * 10) / 10,
    totalScheduledM3: Math.round(totalScheduledM3 * 10) / 10,
    availablePct,
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
