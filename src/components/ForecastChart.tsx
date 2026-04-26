import { CloudRain } from "lucide-react";
import type { DataSource } from "@/components/DataQualityBanner";
import { convertWater } from "@/lib/waterUnits";

export interface ForecastDay {
  date: string;
  dose_mm: number;
  status: "green" | "yellow" | "red";
  /** Daily ETo from Open-Meteo (mm/day). Optional: only present when the
   *  pipeline returned full meteo fields (post-Sentinel pipeline does). */
  eto_mm?: number;
  /** Daily ETc = ETo × Kc (mm/day). Optional. */
  etc_mm?: number;
  /** Daily precipitation forecast (mm). Optional. */
  rain_mm?: number;
  /** Daily mean temperature (°C). Optional. */
  temp_c?: number;
}

const DOW_BG = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const COLOR: Record<ForecastDay["status"], string> = {
  green: "#16a34a",
  yellow: "#d97706",
  red: "#dc2626",
};

interface Props {
  forecast: ForecastDay[];
  source: DataSource;
  areaHectares: number;
}

const sourceLabel: Record<DataSource, string> = {
  "sentinel-2": "Sentinel-2",
  "sentinel-1-sar": "Sentinel-1 SAR",
  "era5-model": "ERA5 модел",
};

function formatM3(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}к м³`;
  return `${n.toFixed(1)} м³`;
}

export function ForecastChart({ forecast, source, areaHectares }: Props) {
  const days = forecast.slice(0, 7);
  if (days.length === 0) return null;

  const max = Math.max(1, ...days.map((d) => d.dose_mm));
  const todayKey = new Date().toISOString().slice(0, 10);

  // SVG grid: 7 columns × ~46px wide, 80px max bar height, padding for labels.
  const colW = 52;
  const barW = 34;
  const maxH = 80;
  const padTop = 26; // room for liter labels
  const padBottom = 36; // room for day + "Днес"
  const width = colW * 7;
  const height = padTop + maxH + padBottom;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <CloudRain className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">
          Прогноза за напояване — следващите 7 дни
        </h3>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="7-day irrigation forecast">
        {days.map((d, i) => {
          const dt = new Date(d.date);
          const isToday = d.date === todayKey;
          const dow = DOW_BG[dt.getUTCDay()];
          const baseColor = COLOR[d.status];
          const fill = isToday ? shade(baseColor, -0.18) : baseColor;
          const h = (d.dose_mm / max) * maxH;
          const x = i * colW + (colW - barW) / 2;
          const y = padTop + maxH - h;

          return (
            <g key={d.date}>
              {/* Liters label above bar (primary) */}
              <text
                x={x + barW / 2}
                y={padTop + maxH - h - 8}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill="currentColor"
                className="text-foreground"
              >
                {d.dose_mm > 0 ? formatM3(convertWater(d.dose_mm, areaHectares).totalM3) : "0 м³"}
              </text>
            </g>
          );
        })}
        {/* Second pass for bars + day labels (kept separate so liter labels don't overlap bars) */}
        {days.map((d, i) => {
          const dt = new Date(d.date);
          const isToday = d.date === todayKey;
          const dow = DOW_BG[dt.getUTCDay()];
          const baseColor = COLOR[d.status];
          const fill = isToday ? shade(baseColor, -0.18) : baseColor;
          const h = (d.dose_mm / max) * maxH;
          const x = i * colW + (colW - barW) / 2;
          const y = padTop + maxH - h;

          return (
            <g key={`bar-${d.date}`}>
              {/* Bar (or thin baseline if dose = 0) */}
              {d.dose_mm > 0 ? (
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx="4"
                  fill={fill}
                  opacity={isToday ? 1 : 0.9}
                />
              ) : (
                <rect
                  x={x}
                  y={padTop + maxH - 3}
                  width={barW}
                  height={3}
                  rx="1.5"
                  fill={fill}
                  opacity="0.4"
                />
              )}

              {/* Day label */}
              <text
                x={x + barW / 2}
                y={padTop + maxH + 14}
                textAnchor="middle"
                fontSize="11"
                fontWeight={isToday ? 700 : 500}
                fill="currentColor"
                className="text-muted-foreground"
              >
                {dow}
              </text>

              {/* "Днес" or raindrop badge */}
              {isToday ? (
                <text
                  x={x + barW / 2}
                  y={padTop + maxH + 26}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="600"
                  fill={baseColor}
                >
                  Днес
                </text>
              ) : d.dose_mm === 0 ? (
                <text x={x + barW / 2} y={padTop + maxH + 26} textAnchor="middle" fontSize="11">
                  💧
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Базирана на {sourceLabel[source]} данни и ERA5 метеорологична прогноза
      </p>
    </div>
  );
}

// Tiny color darkener for "today" bar emphasis.
function shade(hex: string, amount: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const adjust = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c + 255 * amount)));
  r = adjust(r);
  g = adjust(g);
  b = adjust(b);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
