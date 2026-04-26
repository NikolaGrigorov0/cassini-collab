import { useEffect, useState } from "react";
import { Leaf, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getKc, type CropType } from "@/integrations/agri/fao56";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  parcelId: string;
  cropType: string;
  growthPhase: string;
  areaHectares: number;
  /** Latitude/longitude of polygon centroid — needed to fetch ETo. */
  lat: number;
  lon: number;
}

interface Savings {
  baselineMm: number;
  actualMm: number;
  savedMm: number;
  savedM3: number;
  savedPct: number;
  co2Kg: number;
  periodDays: number;
}

const PERIOD_DAYS = 30;
// Energy intensity for pumping (kWh per m³ at ~30 m head)
const KWH_PER_M3 = 0.4;
// BG grid carbon intensity (kg CO₂ per kWh)
const KG_CO2_PER_KWH = 0.4;

export function WaterSavingsCard({
  parcelId,
  cropType,
  growthPhase,
  areaHectares,
  lat,
  lon,
}: Props) {
  const [savings, setSavings] = useState<Savings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const compute = async () => {
      setLoading(true);
      try {
        const today = new Date();
        const start = new Date(today.getTime() - PERIOD_DAYS * 86400_000);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);

        // 1) Actual irrigation in the period (skip undone events)
        const { data: events } = await supabase
          .from("irrigation_events")
          .select("amount_mm,date,undone")
          .eq("parcel_id", parcelId)
          .eq("undone", false)
          .gte("date", fmt(start))
          .lte("date", fmt(today));

        const actualMm = (events ?? []).reduce(
          (s, e) => s + (Number(e.amount_mm) || 0),
          0,
        );

        // 2) Baseline = Σ ETc (ETo × Kc) over the same period using ERA5
        const histUrl = new URL("https://archive-api.open-meteo.com/v1/era5");
        histUrl.searchParams.set("latitude", lat.toFixed(4));
        histUrl.searchParams.set("longitude", lon.toFixed(4));
        histUrl.searchParams.set("start_date", fmt(start));
        histUrl.searchParams.set("end_date", fmt(today));
        histUrl.searchParams.set("daily", "et0_fao_evapotranspiration");
        histUrl.searchParams.set("timezone", "auto");

        const resp = await fetch(histUrl.toString());
        if (!resp.ok) {
          if (!cancelled) setSavings(null);
          return;
        }
        const json = (await resp.json()) as {
          daily?: { et0_fao_evapotranspiration: number[] };
        };
        const etoSeries = json.daily?.et0_fao_evapotranspiration ?? [];
        const totalEto = etoSeries.reduce((s, v) => s + (Number(v) || 0), 0);
        const kc = getKc(cropType as CropType, growthPhase);
        const baselineMm = totalEto * kc;

        const savedMm = Math.max(0, baselineMm - actualMm);
        // 1 mm × 1 m² = 1 L → m³ = mm × hectares × 10
        const savedM3 = savedMm * areaHectares * 10;
        const savedPct = baselineMm > 0 ? (savedMm / baselineMm) * 100 : 0;
        const co2Kg = savedM3 * KWH_PER_M3 * KG_CO2_PER_KWH;

        if (!cancelled) {
          setSavings({
            baselineMm: Math.round(baselineMm),
            actualMm: Math.round(actualMm),
            savedMm: Math.round(savedMm),
            savedM3: Math.round(savedM3),
            savedPct: Math.round(savedPct),
            co2Kg: Math.round(co2Kg),
            periodDays: etoSeries.length,
          });
        }
      } catch {
        if (!cancelled) setSavings(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    compute();
    return () => {
      cancelled = true;
    };
  }, [parcelId, cropType, growthPhase, areaHectares, lat, lon]);

  if (loading) return null;

  // Hide if not enough data: need at least 7 days of ETo and some irrigation
  if (
    !savings ||
    savings.periodDays < 7 ||
    savings.actualMm <= 0 ||
    savings.baselineMm <= 0
  ) {
    return null;
  }

  const formatLiters = (m3: number): string => {
    if (m3 >= 1000) return `${(m3 / 1000).toFixed(1)} хил. m³`;
    return `${m3.toLocaleString("bg-BG")} m³`;
  };

  return (
    <TooltipProvider>
      <div className="flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span>Спестявания (последните {savings.periodDays} дни)</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="Как се изчислява">
                  <Info className="h-3 w-3 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                <p className="font-medium">Как се изчислява:</p>
                <ul className="mt-1 space-y-0.5">
                  <li>База (ETc): {savings.baselineMm} mm</li>
                  <li>Реално полято: {savings.actualMm} mm</li>
                  <li>Спестено: {savings.savedMm} mm</li>
                  <li>× площ {areaHectares.toFixed(2)} ха = {formatLiters(savings.savedM3)}</li>
                  <li>CO₂ ≈ спестени m³ × 0.16 kg</li>
                </ul>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="mt-0.5 text-lg font-bold text-primary">
            ~{savings.savedPct}% по-малко вода
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            ≈ {formatLiters(savings.savedM3)} · {savings.co2Kg} kg CO₂
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
          <Leaf className="h-3 w-3" />
          ECO
        </div>
      </div>
    </TooltipProvider>
  );
}