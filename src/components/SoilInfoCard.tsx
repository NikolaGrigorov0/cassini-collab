// Compact card that surfaces ISRIC SoilGrids-derived insights for a parcel:
// soil texture class, pH, organic carbon and water retention guidance.
// If the parcel has no soil data yet it shows a skeleton + a helpful hint.

import { useMemo } from "react";
import { Mountain, FlaskConical, Sprout, Droplets, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Props {
  soilType?: string | null;
  soilTypeBg?: string | null;
  soilFcPct?: number | null;
  soilWpPct?: number | null;
  soilAwcPct?: number | null;
  soilPh?: number | null;
  soilOrganicCarbon?: number | null; // g/kg (SoilGrids SOC)
  /** True while we're (re-)enriching this parcel from ISRIC. */
  loading?: boolean;
  /** Optional error message — when the API call failed. */
  error?: string | null;
  onRetry?: () => void;
}

function phLabel(ph: number) {
  if (ph < 5.5) return `Кисела (pH ${ph.toFixed(1)})`;
  if (ph < 7) return `Слабо кисела до неутрална (pH ${ph.toFixed(1)})`;
  if (ph < 8) return `Неутрална (pH ${ph.toFixed(1)})`;
  return `Алкална (pH ${ph.toFixed(1)})`;
}

function socLabel(soc: number) {
  if (soc > 30) return "Богата на органика";
  if (soc >= 10) return "Средно органично съдържание";
  return "Ниско органично съдържание";
}

function retentionLabel(soilType: string | null | undefined): string {
  if (!soilType) return "—";
  const lower = soilType.toLowerCase();
  if (lower.startsWith("смесена")) return "Различно задържане в различни части на парцела";
  if (lower.includes("глин")) return "Задържа водата добре — поливай по-рядко";
  if (lower.includes("песъ")) return "Бързо пропуска вода — поливай по-често";
  if (lower.includes("льос")) return "Добро задържане, средна пропускливост";
  return "Оптимално задържане на вода";
}

export function SoilInfoCard({ soilType, soilTypeBg, soilFcPct, soilWpPct, soilAwcPct, soilPh, soilOrganicCarbon, loading, error, onRetry }: Props) {
  const displayType = soilTypeBg || (soilType && soilType !== "Неизвестна" ? soilType : null);
  const retention = useMemo(() => retentionLabel(displayType), [displayType]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mountain className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Информация за почвата</h3>
        </div>
        <Badge variant="secondary" className="text-[10px] font-medium">
          ISRIC SoilGrids
        </Badge>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          ⏳ Зареждане на почвени данни...
        </div>
      ) : error ? (
        <div className="space-y-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-center text-xs text-muted-foreground">
          <p>{error}</p>
          {onRetry && <Button type="button" size="sm" variant="outline" onClick={onRetry}>Опитай отново</Button>}
        </div>
      ) : !displayType && soilPh == null && soilOrganicCarbon == null ? (
        <div className="space-y-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-center text-xs text-muted-foreground">
          <p>⏳ Зареждане на почвени данни...</p>
          {onRetry && <Button type="button" size="sm" variant="outline" onClick={onRetry}>Опитай отново</Button>}
        </div>
      ) : (
        <ul className="space-y-2.5 text-sm">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-base">🪨</span>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">Тип почва</div>
              <div className="font-semibold">{displayType}</div>
            </div>
          </li>
          {(soilFcPct != null || soilWpPct != null || soilAwcPct != null) && (
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-base">💦</span>
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">Воден капацитет</div>
                <div className="font-medium">
                  FC {soilFcPct?.toFixed(1) ?? "—"}% · WP {soilWpPct?.toFixed(1) ?? "—"}% · AWC {soilAwcPct?.toFixed(1) ?? "—"}%
                </div>
              </div>
            </li>
          )}
          {soilPh != null && (
            <li className="flex items-start gap-2">
              <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">Киселинност</div>
                <div className="font-medium">{phLabel(soilPh)}</div>
              </div>
            </li>
          )}
          {soilOrganicCarbon != null && (
            <li className="flex items-start gap-2">
              <Sprout className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">Органика (SOC)</div>
                <div className="font-medium">
                  {socLabel(soilOrganicCarbon)}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({soilOrganicCarbon.toFixed(1)} g/kg)
                  </span>
                </div>
              </div>
            </li>
          )}
          <li className="flex items-start gap-2">
            <Droplets className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">Задържане на вода</div>
              <div className="font-medium">{retention}</div>
            </div>
          </li>
        </ul>
      )}
    </div>
  );
}