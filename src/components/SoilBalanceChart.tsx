// Small 14-day soil-moisture trend chart for the parcel detail panel.
// Pulls from soil_moisture_daily and visualises moisture % vs the MAD line.
import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { Droplets, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchPhenophases, getPhasesForCrop } from "@/lib/phenophases";

interface Props {
  parcelId: string;
  cropType: string;
  growthPhase: string;
}

interface Point {
  date: string;
  short: string;
  moisture: number;
  rain: number;
}

export function SoilBalanceChart({ parcelId, cropType, growthPhase }: Props) {
  const [points, setPoints] = useState<Point[]>([]);
  const [madPct, setMadPct] = useState<number>(50); // default 50% trigger
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      // Resolve MAD trigger percentage from the current phenophase
      try {
        const all = await fetchPhenophases();
        const phases = getPhasesForCrop(all, cropType);
        const current = phases.find((p) => p.phase_name === growthPhase) ?? phases[0];
        if (current?.mad_threshold != null) {
          const trigger = Math.round((1 - current.mad_threshold) * 100);
          if (!cancelled) setMadPct(trigger);
        }
      } catch {
        /* keep default */
      }

      const since = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("soil_moisture_daily")
        .select("date, moisture_pct, rain_mm")
        .eq("parcel_id", parcelId)
        .gte("date", since)
        .order("date", { ascending: true });

      if (!cancelled) {
        if (error || !data) {
          setPoints([]);
        } else {
          setPoints(
            data.map((r) => {
              const d = new Date(r.date as string);
              return {
                date: r.date as string,
                short: `${d.getDate()}.${d.getMonth() + 1}`,
                moisture: Number(r.moisture_pct ?? 0),
                rain: Number(r.rain_mm ?? 0),
              };
            }),
          );
        }
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [parcelId, cropType, growthPhase]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Зареждам воден баланс…
        </div>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="mb-2 flex items-center gap-2">
          <Droplets className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Воден баланс (14 дни)</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Все още няма дневни данни. Първото изчисление ще е утре в 07:00 ч.
        </p>
      </div>
    );
  }

  const last = points[points.length - 1];
  const belowMad = last.moisture < madPct;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Воден баланс (14 дни)</h3>
        </div>
        <div className={`text-xs font-medium ${belowMad ? "text-destructive" : "text-muted-foreground"}`}>
          сега: {last.moisture}% {belowMad ? "· под прага" : ""}
        </div>
      </div>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis dataKey="short" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              formatter={(v: number, name) => [
                name === "moisture" ? `${v}% влага` : `${v} mm дъжд`,
                "",
              ]}
            />
            <ReferenceLine
              y={madPct}
              stroke="hsl(var(--destructive))"
              strokeDasharray="4 4"
              label={{
                value: `MAD ${madPct}%`,
                fontSize: 9,
                fill: "hsl(var(--destructive))",
                position: "insideTopRight",
              }}
            />
            <Line
              type="monotone"
              dataKey="moisture"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ r: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Изчислено от ETo (FAO-56), валежи и регистрирани напоявания. Под пунктираната линия = нужно поливане.
      </p>
    </div>
  );
}
