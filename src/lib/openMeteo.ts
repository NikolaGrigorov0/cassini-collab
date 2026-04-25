// Open-Meteo wrapper: 7-day forecast + WMO weather code mapping.
// Free, no API key required.

export interface DailyForecast {
  date: string;            // ISO date
  tMax: number;            // °C
  tMin: number;            // °C
  precip: number;          // mm
  code: number;            // WMO weather code
}

export interface WeatherToday {
  tMax: number;
  tMin: number;
  precip: number;
  code: number;
}

export interface WmoInfo {
  icon: string;
  label: string;
}

export function wmoToInfo(code: number): WmoInfo {
  if (code === 0) return { icon: "☀️", label: "Ясно" };
  if (code >= 1 && code <= 3) return { icon: "🌤️", label: "Частично облачно" };
  if (code >= 45 && code <= 48) return { icon: "🌫️", label: "Мъгла" };
  if (code >= 51 && code <= 67) return { icon: "🌧️", label: "Дъжд" };
  if (code >= 71 && code <= 77) return { icon: "🌨️", label: "Сняг" };
  if (code >= 80 && code <= 82) return { icon: "🌦️", label: "Превалявания" };
  if (code >= 95 && code <= 99) return { icon: "⛈️", label: "Гръмотевична буря" };
  return { icon: "☁️", label: "Облачно" };
}

export async function fetchForecast(lat: number, lon: number): Promise<DailyForecast[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode` +
    `&forecast_days=7&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("forecast fetch failed");
  const j = await r.json();
  const d = j?.daily;
  if (!d?.time) return [];
  const out: DailyForecast[] = [];
  for (let i = 0; i < d.time.length; i++) {
    out.push({
      date: d.time[i],
      tMax: Number(d.temperature_2m_max?.[i] ?? 0),
      tMin: Number(d.temperature_2m_min?.[i] ?? 0),
      precip: Number(d.precipitation_sum?.[i] ?? 0),
      code: Number(d.weathercode?.[i] ?? 0),
    });
  }
  return out;
}

export async function fetchToday(lat: number, lon: number): Promise<WeatherToday | null> {
  const days = await fetchForecast(lat, lon);
  if (!days.length) return null;
  const t = days[0];
  return { tMax: t.tMax, tMin: t.tMin, precip: t.precip, code: t.code };
}
