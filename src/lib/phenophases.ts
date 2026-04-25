// Phenophases helpers: fetch catalog, derive current phase from sowing date,
// compute dynamic Kc from NDVI (FAO-56 recommended formula).
import { supabase } from "@/integrations/supabase/client";

export interface Phenophase {
  id: string;
  crop_type: string;
  phase_name: string;
  order_index: number;
  typical_duration_days: number;
  kc_base: number;
  mad_threshold: number;
}

// Cache phenophases per session — they rarely change.
let _cache: Phenophase[] | null = null;

export async function fetchPhenophases(): Promise<Phenophase[]> {
  if (_cache) return _cache;
  const { data, error } = await supabase
    .from("phenophases")
    .select("*")
    .order("crop_type")
    .order("order_index");
  if (error) throw error;
  _cache = (data ?? []) as Phenophase[];
  return _cache;
}

export function getPhasesForCrop(all: Phenophase[], cropType: string): Phenophase[] {
  return all.filter((p) => p.crop_type === cropType).sort((a, b) => a.order_index - b.order_index);
}

/**
 * Given sowing date and current date, return current phase + days into it.
 */
export function deriveCurrentPhase(
  phases: Phenophase[],
  sowingDate: Date,
  today: Date = new Date(),
): { phase: Phenophase | null; dayInPhase: number; totalDays: number; phaseIndex: number } {
  const daysSince = Math.max(0, Math.floor((today.getTime() - sowingDate.getTime()) / 86400000));
  let acc = 0;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const start = acc;
    const end = acc + p.typical_duration_days;
    if (daysSince < end) {
      return { phase: p, dayInPhase: daysSince - start, totalDays: p.typical_duration_days, phaseIndex: i };
    }
    acc = end;
  }
  // Past last phase — return last phase as completed
  const last = phases[phases.length - 1];
  return { phase: last ?? null, dayInPhase: last?.typical_duration_days ?? 0, totalDays: last?.typical_duration_days ?? 0, phaseIndex: phases.length - 1 };
}

/**
 * Dynamic Kc from NDVI (FAO-56 recommended):
 *   Kc = 1.25 × NDVI + 0.2
 * Clamped to [0.2, 1.4] to avoid unrealistic values from noisy NDVI.
 * If NDVI is null/undefined, falls back to phase Kc_base.
 */
export function adjustKc(kcBase: number, ndvi: number | null | undefined): number {
  if (ndvi == null || isNaN(ndvi)) return kcBase;
  const kc = 1.25 * ndvi + 0.2;
  return Math.max(0.2, Math.min(1.4, kc));
}

export function phaseProgressPct(dayInPhase: number, totalDays: number): number {
  if (totalDays <= 0) return 0;
  return Math.min(100, Math.round((dayInPhase / totalDays) * 100));
}
