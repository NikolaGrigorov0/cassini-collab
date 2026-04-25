// Vertical "water battery" indicator for a parcel.
// Zones (based on plant-available water % of field capacity):
//   100%       — Full capacity (neutral grey)
//   70–100%    — Optimal (green)
//   50–70%     — Watch (yellow)
//   <50% (MAD) — Irrigate now (red)
//   0%         — Wilting point (critical)

import { useMemo } from "react";

export interface WaterBatteryProps {
  /** Soil moisture as a percentage 0–100 of field capacity. */
  moisturePct: number;
  /** Optional compact mode (smaller height) used inside lists. */
  compact?: boolean;
  /** Show numeric % label below the battery. */
  showLabel?: boolean;
  /** Optional className. */
  className?: string;
}

type Zone = { color: string; label: string; description: string };

function zoneFor(pct: number): Zone {
  if (pct >= 95) return { color: "#9ca3af", label: "Пълен капацитет", description: "Почвата е до полска влагоемност." };
  if (pct >= 70) return { color: "#16a34a", label: "Оптимална влага", description: "Растението не е под стрес." };
  if (pct >= 50) return { color: "#eab308", label: "Скоро поливане", description: "Влагата намалява, планирай поливане." };
  if (pct > 5)  return { color: "#dc2626", label: "Полей сега", description: "Под MAD прага — рискова зона." };
  return { color: "#7f1d1d", label: "Точка на увяхване", description: "Критично — сериозен стрес за културата." };
}

export function WaterBattery({ moisturePct, compact = false, showLabel = true, className = "" }: WaterBatteryProps) {
  const pct = Math.max(0, Math.min(100, moisturePct));
  const zone = useMemo(() => zoneFor(pct), [pct]);

  const heightClass = compact ? "h-16" : "h-28";
  const widthClass = compact ? "w-7" : "w-10";

  return (
    <div className={`inline-flex flex-col items-center gap-1.5 ${className}`} title={`${zone.label}: ${pct.toFixed(0)}% — ${zone.description}`}>
      <div className="relative">
        {/* Battery cap */}
        <div className={`mx-auto mb-0.5 rounded-sm bg-foreground/40 ${compact ? "h-1 w-3" : "h-1.5 w-4"}`} />
        {/* Battery body */}
        <div className={`relative overflow-hidden rounded-md border-2 border-foreground/40 bg-muted ${heightClass} ${widthClass}`}>
          {/* Reference markers */}
          <div className="absolute inset-x-0 top-[30%] border-t border-dashed border-foreground/20" />
          <div className="absolute inset-x-0 top-[50%] border-t border-dashed border-foreground/20" />
          {/* Fill */}
          <div
            className="absolute inset-x-0 bottom-0 transition-all duration-500"
            style={{ height: `${pct}%`, backgroundColor: zone.color }}
          />
          {/* Subtle glow on red */}
          {pct < 50 && (
            <div
              className="absolute inset-0 animate-pulse opacity-30"
              style={{ background: `linear-gradient(0deg, ${zone.color} 0%, transparent 70%)` }}
            />
          )}
        </div>
      </div>
      {showLabel && (
        <div className="text-center">
          <div className={`font-bold leading-none ${compact ? "text-[11px]" : "text-sm"}`} style={{ color: zone.color }}>
            {pct.toFixed(0)}%
          </div>
          {!compact && (
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{zone.label}</div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Heuristic: convert NDMI (-1..+1) to an approximate plant-available
 * moisture %. NDMI ≈ 0.4 → fully saturated; NDMI ≤ -0.2 → wilting.
 *
 * This is a placeholder until real soil-moisture balance (FC/WP/AWC) is
 * computed in Phase 2. It at least makes the battery move in the right
 * direction with current Sentinel data.
 */
export function ndmiToMoisturePct(ndmi: number): number {
  const clamped = Math.max(-0.3, Math.min(0.5, ndmi));
  return Math.round(((clamped + 0.3) / 0.8) * 100);
}
