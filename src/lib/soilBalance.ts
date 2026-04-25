// Soil-moisture balance helpers (FAO-56 simplified).
//
// We model the root-zone water content as a fraction of plant-available
// water capacity (AWC). Each day:
//   balance_mm[t] = clamp(balance_mm[t-1] + rain + irrigation − ETc, 0, AWC)
//   moisture_pct  = 100 × balance_mm / AWC
//
// MAD (Management Allowed Depletion) is the % of AWC that may be depleted
// before the crop goes into water stress. Phenophase-specific (e.g. 0.50
// for vegetative, 0.40 for reproductive). When moisture_pct drops below
// (1 − MAD) × 100, irrigation is recommended.

export interface BalanceInputs {
  /** Previous day's balance in mm (depth of water in root zone). */
  prevBalanceMm: number;
  /** Available water capacity (mm) — saturated minus wilting point in root zone. */
  awcMm: number;
  /** Reference evapotranspiration today (mm). */
  etoMm: number;
  /** Crop coefficient adjusted from NDVI (FAO-56). */
  kc: number;
  /** Rain today (mm). */
  rainMm: number;
  /** Irrigation applied today (mm) — sum of all manual irrigation events. */
  irrigationMm: number;
}

export interface BalanceResult {
  balanceMm: number;     // depth of water in root zone after today (mm)
  etcMm: number;         // crop evapotranspiration today (mm)
  moisturePct: number;   // 0..100 of AWC
  depletedPct: number;   // 0..100 = 100 - moisturePct
}

/** Compute today's water balance from yesterday + today's inputs. */
export function computeDailyBalance(i: BalanceInputs): BalanceResult {
  const awc = Math.max(1, i.awcMm); // avoid div/0
  const etc = Math.max(0, i.etoMm * i.kc);
  const raw = i.prevBalanceMm + i.rainMm + i.irrigationMm - etc;
  const balance = Math.max(0, Math.min(awc, raw));
  const moisturePct = Math.round((balance / awc) * 100);
  return {
    balanceMm: Number(balance.toFixed(2)),
    etcMm: Number(etc.toFixed(2)),
    moisturePct,
    depletedPct: 100 - moisturePct,
  };
}

/**
 * Whether the current moisture has crossed below the MAD threshold.
 * `madThreshold` is the depletion fraction (e.g. 0.5 = irrigate when 50%
 * of AWC is depleted, i.e. moisturePct < 50).
 */
export function isBelowMad(moisturePct: number, madThreshold: number): boolean {
  const triggerPct = (1 - madThreshold) * 100;
  return moisturePct < triggerPct;
}

/**
 * Default AWC (mm) when the parcel has no enriched soil data yet. Loamy
 * soil ≈ 150 mm/m × 0.6 m root depth = 90 mm. Conservative fallback.
 */
export const DEFAULT_AWC_MM = 90;

/** Format moisture % into a colour zone matching WaterBattery. */
export function moistureZone(pct: number): "full" | "optimal" | "watch" | "low" | "critical" {
  if (pct >= 95) return "full";
  if (pct >= 70) return "optimal";
  if (pct >= 50) return "watch";
  if (pct > 5) return "low";
  return "critical";
}
