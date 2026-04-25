// Lightweight weather lookup using Open-Meteo (no API key required).
// Used by "Вали днес" to auto-detect today's rainfall + nearest place name
// based on a parcel's centroid.

export interface RainInfo {
  mm: number;          // precipitation today (mm)
  place: string;       // nearest place / area label
  lat: number;
  lon: number;
}

/** Compute centroid (lon, lat) from a GeoJSON Polygon or MultiPolygon. */
export function geometryCentroid(geom: unknown): { lat: number; lon: number } | null {
  let parsed: any = geom;
  if (typeof geom === "string") {
    try { parsed = JSON.parse(geom); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object") return null;

  const rings: number[][][] =
    parsed.type === "Polygon" ? parsed.coordinates :
    parsed.type === "MultiPolygon" ? parsed.coordinates.flat() :
    [];
  const ring = rings?.[0];
  if (!ring || ring.length === 0) return null;

  let sx = 0, sy = 0, n = 0;
  for (const [x, y] of ring) {
    if (typeof x === "number" && typeof y === "number") {
      sx += x; sy += y; n++;
    }
  }
  if (!n) return null;
  return { lon: sx / n, lat: sy / n };
}

/** Reverse-geocode lat/lon to a Bulgarian-friendly place label. */
async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=bg&count=1`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("geocode failed");
    const j = await r.json();
    const hit = j?.results?.[0];
    if (!hit) return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    const parts = [hit.name, hit.admin1].filter(Boolean);
    return parts.join(", ");
  } catch {
    return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  }
}

/** Fetch today's rainfall (mm) at a given coordinate from Open-Meteo. */
export async function fetchTodayRainfall(lat: number, lon: number): Promise<number> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=precipitation_sum&timezone=auto&forecast_days=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("weather fetch failed");
  const j = await r.json();
  const mm = j?.daily?.precipitation_sum?.[0];
  return typeof mm === "number" ? mm : 0;
}

/** One-shot helper: from a parcel geometry → today's rain + place name. */
export async function getRainForGeometry(geom: unknown): Promise<RainInfo | null> {
  const c = geometryCentroid(geom);
  if (!c) return null;
  const [mm, place] = await Promise.all([
    fetchTodayRainfall(c.lat, c.lon),
    reverseGeocode(c.lat, c.lon),
  ]);
  return { mm: Math.round(mm * 10) / 10, place, lat: c.lat, lon: c.lon };
}
