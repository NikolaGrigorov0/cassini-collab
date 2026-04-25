// 7-day forecast card displayed in the parcel detail panel.
// Shows daily icon, min/max temp and precipitation. When the next 2 days
// have >10mm precipitation total, a rain advisory banner is shown above.

import { useEffect, useState } from "react";
import { CloudRain, Loader2 } from "lucide-react";
import { fetchForecast, wmoToInfo, type DailyForecast } from "@/lib/openMeteo";
import { geometryCentroid } from "@/lib/weather";

interface Props {
  geometry: unknown;
}

const DOW = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export function WeatherForecast({ geometry }: Props) {
  const [days, setDays] = useState<DailyForecast[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const c = geometryCentroid(geometry);
    if (!c) { setLoading(false); setErr("Няма координати"); return; }
    let cancelled = false;
    setLoading(true);
    fetchForecast(c.lat, c.lon)
      .then((d) => { if (!cancelled) setDays(d); })
      .catch(() => { if (!cancelled) setErr("Прогнозата не е достъпна"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [geometry]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="mb-3 flex items-center gap-2">
          <CloudRain className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">7-дневна прогноза за времето</h3>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Зареждам…
        </div>
      </div>
    );
  }

  if (err || !days || days.length === 0) {
    return null;
  }

  // Rain advisory: next 2 days precipitation sum > 10mm
  const nextTwo = days.slice(0, 2).reduce((s, d) => s + d.precip, 0);
  const showAdvisory = nextTwo > 10;

  return (
    <div className="space-y-3">
      {showAdvisory && (
        <div className="flex items-start gap-3 rounded-2xl border border-blue-300 bg-blue-50 p-4 text-sm text-blue-900">
          <span className="text-2xl leading-none">🌧️</span>
          <div>
            <div className="font-semibold">Очаква се дъжд</div>
            <div className="text-xs">
              През следващите 2 дни се очакват {nextTwo.toFixed(1)} мм валежи.
              Препоръчваме да отложите поливането.
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="mb-3 flex items-center gap-2">
          <CloudRain className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">7-дневна прогноза за времето</h3>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {days.map((d, i) => {
            const info = wmoToInfo(d.code);
            const dt = new Date(d.date);
            const dow = i === 0 ? "Днес" : DOW[dt.getDay()];
            const wet = d.precip >= 5;
            return (
              <div
                key={d.date}
                className="flex flex-col items-center rounded-lg border border-border/60 bg-muted/20 px-1 py-2"
                title={info.label}
              >
                <div className="text-[10px] font-semibold uppercase text-muted-foreground">{dow}</div>
                <div className="my-0.5 text-lg leading-none">{info.icon}</div>
                <div className="text-[11px] font-bold">
                  {Math.round(d.tMax)}°
                </div>
                <div className="text-[10px] text-muted-foreground">{Math.round(d.tMin)}°</div>
                <div className={`mt-0.5 text-[10px] font-medium ${wet ? "text-blue-600" : "text-muted-foreground"}`}>
                  {d.precip.toFixed(1)}мм
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
