import { Satellite, Radar, CloudOff } from "lucide-react";

export type DataSource = "sentinel-2" | "sentinel-1-sar" | "era5-model";

interface DataQualityBannerProps {
  source: DataSource;
  confidence: number;
  cloudCoverage: number;
  lastUpdated: Date;
}

function formatRelative(d: Date) {
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "току-що";
  if (minutes < 60) return `преди ${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `преди ${hours} ч`;
  const days = Math.round(hours / 24);
  return `преди ${days} ${days === 1 ? "ден" : "дни"}`;
}

export function DataQualityBanner({
  source,
  confidence,
  cloudCoverage,
  lastUpdated,
}: DataQualityBannerProps) {
  const updatedLabel = formatRelative(lastUpdated);

  if (source === "sentinel-2") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-green-700">
        <Satellite className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="text-sm">
          <div className="font-medium">
            ✓ Sentinel-2 оптичен спътник · Точност {confidence}% · {updatedLabel}
          </div>
        </div>
      </div>
    );
  }

  if (source === "sentinel-1-sar") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-700">
        <Radar className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="text-sm">
          <div className="font-medium">
            ◉ Облачност {cloudCoverage}% · Активен Sentinel-1 радар · Точност {confidence}%
          </div>
          <div className="mt-0.5 text-xs text-blue-700/80">
            Радарът вижда през облаци и работи денонощно
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
      <CloudOff className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="text-sm">
        <div className="font-medium">
          ⚠ Продължителна облачност · Прогноза от ERA5 метеорологичен модел · Точност {confidence}%
        </div>
        <div className="mt-0.5 text-xs text-amber-700/80">
          Препоръчваме да изчакате следваща спътникова снимка
        </div>
      </div>
    </div>
  );
}
