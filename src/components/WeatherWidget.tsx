// Compact today weather widget shown in the dashboard header.
// Anchored at the centroid of all the user's parcels.

import { useEffect, useState } from "react";
import { fetchToday, wmoToInfo, type WeatherToday } from "@/lib/openMeteo";

interface Props {
  /** Centroid lat/lon — when null the widget renders nothing. */
  center: { lat: number; lon: number } | null;
}

export function WeatherWidget({ center }: Props) {
  const [w, setW] = useState<WeatherToday | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!center) return;
    let cancelled = false;
    setLoading(true);
    fetchToday(center.lat, center.lon)
      .then((d) => { if (!cancelled) setW(d); })
      .catch(() => { /* silent */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [center?.lat, center?.lon]);

  if (!center) return null;
  if (loading && !w) {
    return (
      <div className="hidden items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs md:inline-flex">
        <span className="opacity-60">⏳</span>
        <span className="text-muted-foreground">Зарежда времето…</span>
      </div>
    );
  }
  if (!w) return null;
  const info = wmoToInfo(w.code);
  return (
    <div
      className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs shadow-sm md:inline-flex"
      title={`${info.label} · ${w.precip.toFixed(1)} мм валеж днес`}
    >
      <span className="text-base leading-none">{info.icon}</span>
      <span className="font-semibold">{Math.round(w.tMax)}°/{Math.round(w.tMin)}°</span>
      {w.precip > 0 && (
        <span className="text-blue-600">💧{w.precip.toFixed(1)}мм</span>
      )}
    </div>
  );
}
