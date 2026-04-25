import { useEffect, useState } from "react";
import { Sprout, Loader2 } from "lucide-react";
import {
  fetchPhenophases,
  getPhasesForCrop,
  deriveCurrentPhase,
  adjustKc,
  phaseProgressPct,
  type Phenophase,
} from "@/lib/phenophases";

interface Props {
  cropType: string;
  /** Optional sowing date — if missing, assume 60 days ago for demo. */
  sowingDate?: Date;
  ndvi?: number | null;
}

export function PhenophaseTimeline({ cropType, sowingDate, ndvi }: Props) {
  const [phases, setPhases] = useState<Phenophase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPhenophases()
      .then((all) => {
        if (cancelled) return;
        setPhases(getPhasesForCrop(all, cropType));
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [cropType]);

  if (error) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground">
        Не можах да заредя фенофазите.
      </div>
    );
  }
  if (!phases) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Зареждам фенофази…
      </div>
    );
  }
  if (phases.length === 0) {
    return null; // no phenophases for this crop
  }

  const sd = sowingDate ?? new Date(Date.now() - 60 * 86400000);
  const { phase, dayInPhase, totalDays, phaseIndex } = deriveCurrentPhase(phases, sd);
  const progress = phaseProgressPct(dayInPhase, totalDays);
  const kcBase = phase?.kc_base ?? 0;
  const kcAdj = adjustKc(kcBase, ndvi ?? null);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sprout className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Фенофаза</h3>
        </div>
        {phase && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            {phase.phase_name}
          </span>
        )}
      </div>

      {/* Timeline strip */}
      <div className="mb-3 flex h-8 overflow-hidden rounded-lg border border-border">
        {phases.map((p, i) => {
          const isPast = i < phaseIndex;
          const isCurrent = i === phaseIndex;
          return (
            <div
              key={p.id}
              className={`relative flex flex-1 items-center justify-center text-[10px] font-medium ${
                isPast
                  ? "bg-primary/30 text-primary-foreground"
                  : isCurrent
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
              title={`${p.phase_name} (${p.typical_duration_days} дни, Kc=${p.kc_base})`}
            >
              {isCurrent && (
                <div
                  className="absolute inset-y-0 left-0 bg-primary-foreground/20"
                  style={{ width: `${progress}%` }}
                />
              )}
              <span className="relative truncate px-1">{i + 1}</span>
            </div>
          );
        })}
      </div>

      {phase && (
        <div className="grid grid-cols-3 gap-3 text-center text-xs">
          <div>
            <div className="text-muted-foreground">Ден във фазата</div>
            <div className="font-bold text-foreground">{dayInPhase}/{totalDays}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Kc базов</div>
            <div className="font-bold text-foreground">{kcBase.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Kc по NDVI</div>
            <div className="font-bold text-secondary">{kcAdj.toFixed(2)}</div>
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Динамичен Kc = 1.25 × NDVI + 0.2 (FAO-56). Влияе на дозата напояване.
      </p>
    </div>
  );
}
