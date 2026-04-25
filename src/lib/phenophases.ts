// Phenophase library — detailed sub-phases (7-8 per crop) with sowing-day windows.
// The active sub-phase for a parcel is derived from `parcels.sowing_date`
// unless the user has set a manual override in `parcel_growth`.
import { supabase } from "@/integrations/supabase/client";

export interface Phenophase {
  id: string;
  crop_type: string;
  phase_name: string;
  order_index: number;
  typical_duration_days: number;
  days_from_sowing_start: number | null;
  days_from_sowing_end: number | null;
  kc_base: number;
  mad_threshold: number;
  description: string | null;
  is_critical: boolean;
}

export interface ParcelGrowthRow {
  id: string;
  parcel_id: string;
  current_phase_id: string | null;
  is_manual_override: boolean;
  manual_override_at: string | null;
  updated_at: string;
}

let _cache: Phenophase[] | null = null;

export async function fetchPhenophases(): Promise<Phenophase[]> {
  if (_cache) return _cache;
  const { data, error } = await supabase
    .from("phenophases")
    .select("*")
    .order("crop_type")
    .order("order_index");
  if (error) throw error;
  _cache = (data ?? []) as unknown as Phenophase[];
  return _cache;
}

export function getPhasesForCrop(all: Phenophase[], cropType: string): Phenophase[] {
  return all
    .filter((p) => p.crop_type === cropType)
    .sort((a, b) => a.order_index - b.order_index);
}

/**
 * Pick the sub-phase whose [start, end) window contains `daysSinceSowing`.
 * Falls back to the last phase once the crop is past its lifecycle.
 */
export function pickPhaseForDays(
  phases: Phenophase[],
  daysSinceSowing: number,
): { phase: Phenophase | null; index: number; dayInPhase: number; totalDays: number } {
  if (phases.length === 0) return { phase: null, index: -1, dayInPhase: 0, totalDays: 0 };
  const d = Math.max(0, Math.floor(daysSinceSowing));
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const start = p.days_from_sowing_start ?? 0;
    const end = p.days_from_sowing_end ?? start + p.typical_duration_days;
    if (d >= start && d < end) {
      return { phase: p, index: i, dayInPhase: d - start, totalDays: end - start };
    }
  }
  const last = phases[phases.length - 1];
  const start = last.days_from_sowing_start ?? 0;
  const end = last.days_from_sowing_end ?? start + last.typical_duration_days;
  return { phase: last, index: phases.length - 1, dayInPhase: end - start, totalDays: end - start };
}

export function daysSince(date: Date, today: Date = new Date()): number {
  return Math.floor((today.getTime() - date.getTime()) / 86400000);
}

export function phaseProgressPct(dayInPhase: number, totalDays: number): number {
  if (totalDays <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((dayInPhase / totalDays) * 100)));
}

/** Dynamic Kc from NDVI (FAO-56). Falls back to phase Kc if NDVI missing. */
export function adjustKc(kcBase: number, ndvi: number | null | undefined): number {
  if (ndvi == null || isNaN(ndvi)) return kcBase;
  const kc = 1.25 * ndvi + 0.2;
  return Math.max(0.2, Math.min(1.4, kc));
}

/** Days until the next phase begins, given current days-since-sowing. */
export function daysUntilNextPhase(phases: Phenophase[], daysSinceSowing: number): number | null {
  const { index } = pickPhaseForDays(phases, daysSinceSowing);
  if (index < 0 || index >= phases.length - 1) return null;
  const next = phases[index + 1];
  const start = next.days_from_sowing_start ?? 0;
  return Math.max(0, start - daysSinceSowing);
}

// ---------- parcel_growth (per-parcel current phase + override) ----------

export async function getParcelGrowth(parcelId: string): Promise<ParcelGrowthRow | null> {
  const { data, error } = await supabase
    .from("parcel_growth")
    .select("*")
    .eq("parcel_id", parcelId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as ParcelGrowthRow | null;
}

/**
 * Ensure parcel_growth reflects the auto-derived phase from sowing_date.
 * Skips writes when the user has set a manual override.
 * Returns the current phase id we should display.
 */
export async function syncAutoPhase(
  parcelId: string,
  cropType: string,
  sowingDate: Date | null,
): Promise<{ phase: Phenophase | null; row: ParcelGrowthRow | null; daysSince: number }> {
  const phases = getPhasesForCrop(await fetchPhenophases(), cropType);
  const row = await getParcelGrowth(parcelId);

  if (!sowingDate || phases.length === 0) {
    // Without a sowing date we can't auto-derive. Return whatever override (if any).
    const phase = row?.current_phase_id
      ? phases.find((p) => p.id === row.current_phase_id) ?? null
      : null;
    return { phase, row, daysSince: 0 };
  }

  const days = daysSince(sowingDate);
  const { phase: autoPhase } = pickPhaseForDays(phases, days);

  if (row?.is_manual_override) {
    const manualPhase =
      phases.find((p) => p.id === row.current_phase_id) ?? autoPhase;
    return { phase: manualPhase, row, daysSince: days };
  }

  // Auto mode — write only when phase changed (or row missing).
  if (!row || row.current_phase_id !== autoPhase?.id) {
    const payload = {
      parcel_id: parcelId,
      current_phase_id: autoPhase?.id ?? null,
      is_manual_override: false,
      manual_override_at: null,
      updated_at: new Date().toISOString(),
    };
    const { data: upserted, error } = await supabase
      .from("parcel_growth")
      .upsert(payload, { onConflict: "parcel_id" })
      .select("*")
      .single();
    if (error) {
      console.warn("syncAutoPhase upsert failed:", error.message);
      return { phase: autoPhase, row, daysSince: days };
    }
    return { phase: autoPhase, row: upserted as ParcelGrowthRow, daysSince: days };
  }

  return { phase: autoPhase, row, daysSince: days };
}

export async function setManualPhase(
  parcelId: string,
  phaseId: string,
): Promise<ParcelGrowthRow | null> {
  const { data, error } = await supabase
    .from("parcel_growth")
    .upsert(
      {
        parcel_id: parcelId,
        current_phase_id: phaseId,
        is_manual_override: true,
        manual_override_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "parcel_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as ParcelGrowthRow;
}

export async function clearManualOverride(parcelId: string): Promise<void> {
  const { error } = await supabase
    .from("parcel_growth")
    .update({
      is_manual_override: false,
      manual_override_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("parcel_id", parcelId);
  if (error) throw error;
}

// Crop emoji per stage (small visual cue in the timeline). Falls back to a generic seedling.
export function phaseEmoji(orderIndex: number, total: number): string {
  const ratio = total > 1 ? orderIndex / total : 0;
  if (ratio < 0.2) return "🌱";
  if (ratio < 0.4) return "🌿";
  if (ratio < 0.6) return "🌾";
  if (ratio < 0.8) return "🌸";
  return "🍂";
}