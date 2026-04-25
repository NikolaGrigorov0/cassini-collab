// FAO-56 helpers + multi-source satellite pipeline.
// Priority: Sentinel-2 (optical) → Sentinel-1 SAR (radar) → ERA5/Open-Meteo model.
//
// Used by the daily cron and the on-demand /api/fetch-ndmi endpoint.

export type GrowthPhase = "initial" | "development" | "mid" | "late";
export type CropType = keyof typeof KC;

export const KC = {
  wheat: { initial: 0.4, development: 0.7, mid: 1.15, late: 0.4 },
  corn: { initial: 0.3, development: 0.7, mid: 1.2, late: 0.6 },
  tomatoes: { initial: 0.6, development: 0.85, mid: 1.15, late: 0.8 },
  sunflower: { initial: 0.35, development: 0.75, mid: 1.1, late: 0.5 },
  vineyard: { initial: 0.3, development: 0.55, mid: 0.8, late: 0.45 },
} as const;

export function getKc(crop?: string | null, phase?: string | null): number {
  const cropTable = crop && (KC as Record<string, Record<string, number>>)[crop];
  if (!cropTable) return 0.85;
  return phase ? cropTable[phase] ?? 0.85 : 0.85;
}

export type DataSource = "sentinel-2" | "sentinel-1-sar" | "era5-model";

// ---------- Sentinel Hub OAuth2 ----------
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getSentinelToken(): Promise<string | null> {
  // Accept either SENTINEL_HUB_* (legacy) or SENTINEL_* (spec) names
  const id =
    process.env.SENTINEL_HUB_CLIENT_ID ?? process.env.SENTINEL_CLIENT_ID;
  const secret =
    process.env.SENTINEL_HUB_CLIENT_SECRET ?? process.env.SENTINEL_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const resp = await fetch("https://services.sentinel-hub.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!resp.ok) {
    console.error("Sentinel Hub OAuth failed:", resp.status, await resp.text());
    return null;
  }
  const json = (await resp.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.token;
}

// ---------- Sentinel-2 (optical): NDMI + NDVI + cloud coverage ----------
export interface S2Result {
  ndmi: number;
  ndvi: number;
  cloudCoverage: number; // %
}

export async function fetchSentinel2(
  geometry: GeoJSON.Polygon,
  dateFrom: string,
  dateTo: string,
): Promise<S2Result | null> {
  const token = await getSentinelToken();
  if (!token) return null;

  // Use the SCL band to compute cloud fraction; B04/B08/B11 for NDVI/NDMI.
  // SCL classes 8,9,10 = clouds (medium/high prob + thin cirrus), 3 = shadow.
  const evalscript = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04","B08","B11","SCL","dataMask"] }],
    output: [
      { id: "ndmi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "cloud", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  let ndmi = (s.B08 - s.B11) / (s.B08 + s.B11 + 1e-6);
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 1e-6);
  let cloud = (s.SCL == 8 || s.SCL == 9 || s.SCL == 10 || s.SCL == 3) ? 1.0 : 0.0;
  return { ndmi: [ndmi], ndvi: [ndvi], cloud: [cloud], dataMask: [s.dataMask] };
}`;

  const resp = await fetch("https://services.sentinel-hub.com/api/v1/statistics", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      input: {
        bounds: { geometry },
        data: [{ type: "sentinel-2-l2a", dataFilter: { maxCloudCoverage: 80 } }],
      },
      aggregation: {
        timeRange: { from: dateFrom, to: dateTo },
        aggregationInterval: { of: "P5D" },
        evalscript,
        resx: 10,
        resy: 10,
      },
    }),
  });

  if (!resp.ok) {
    console.error("Sentinel-2 stats error:", resp.status, await resp.text());
    return null;
  }
  const json = (await resp.json()) as {
    data?: Array<{ outputs: Record<string, { bands: Record<string, { stats: { mean: number } }> }> }>;
  };
  const data = json.data ?? [];
  for (let i = data.length - 1; i >= 0; i--) {
    const interval = data[i];
    // Sentinel Hub може да върне bands с ключ "B0" или името на output-а.
    // Опитваме и двете за по-голяма устойчивост.
    const pickMean = (id: string): number | undefined => {
      const bands = interval?.outputs?.[id]?.bands;
      if (!bands) return undefined;
      const first = bands["B0"] ?? Object.values(bands)[0];
      return first?.stats?.mean;
    };
    const ndmi = pickMean("ndmi");
    const ndvi = pickMean("ndvi");
    const cloudFrac = pickMean("cloud");
    if (
      typeof ndmi === "number" &&
      typeof ndvi === "number" &&
      Number.isFinite(ndmi) &&
      Number.isFinite(ndvi)
    ) {
      const cloudCoverage = Number.isFinite(cloudFrac) ? Math.round((cloudFrac as number) * 100) : 0;
      return { ndmi, ndvi, cloudCoverage };
    }
  }
  return null;
}

// ---------- Sentinel-1 SAR (radar — works through clouds) ----------
// Uses VH/VV cross-pol ratio normalised to [-1, 1]. Wetter soil/canopy → higher
// VH backscatter relative to VV.
export interface S1Result {
  ndmiProxy: number; // normalised VH/VV ratio in [-1, 1]
}

export async function fetchSentinel1Sar(
  geometry: GeoJSON.Polygon,
  dateFrom: string,
  dateTo: string,
): Promise<S1Result | null> {
  const token = await getSentinelToken();
  if (!token) return null;

  const evalscript = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["VV","VH","dataMask"] }],
    output: [
      { id: "ratio", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  // Linear power ratio VH/VV normalised to roughly [-1, 1]
  let r = s.VH / (s.VV + 1e-6);
  // Empirically VH/VV ranges ~0.05–0.6; map to -1..1
  let n = Math.max(-1, Math.min(1, (r - 0.25) / 0.25));
  return { ratio: [n], dataMask: [s.dataMask] };
}`;

  const resp = await fetch("https://services.sentinel-hub.com/api/v1/statistics", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      input: {
        bounds: { geometry },
        data: [
          {
            type: "sentinel-1-grd",
            dataFilter: {
              acquisitionMode: "IW",
              polarization: "DV",
              resolution: "HIGH",
            },
            processing: { backCoeff: "GAMMA0_TERRAIN", orthorectify: true },
          },
        ],
      },
      aggregation: {
        timeRange: { from: dateFrom, to: dateTo },
        aggregationInterval: { of: "P3D" },
        evalscript,
        resx: 20,
        resy: 20,
      },
    }),
  });

  if (!resp.ok) {
    console.error("Sentinel-1 SAR stats error:", resp.status, await resp.text());
    return null;
  }
  const json = (await resp.json()) as {
    data?: Array<{ outputs: Record<string, { bands: Record<string, { stats: { mean: number } }> }> }>;
  };
  const data = json.data ?? [];
  for (let i = data.length - 1; i >= 0; i--) {
    const bands = data[i]?.outputs?.ratio?.bands;
    const v = bands?.["B0"]?.stats?.mean ?? Object.values(bands ?? {})[0]?.stats?.mean;
    if (typeof v === "number" && Number.isFinite(v)) {
      return { ndmiProxy: v };
    }
  }
  return null;
}

// ---------- ERA5 / Open-Meteo: weather (ETo + rainfall + 7-day forecast) ----------
//
// We use the Open-Meteo "ECMWF IFS / ERA5" backed endpoints. They return the
// same FAO ETo and precipitation that the upstream ECMWF CDS API would, but
// answer instantly (no async polling queue) and need no API key, which makes
// them viable inside a Worker server route. CDS_UID / CDS_API_KEY remain
// reserved for future direct CDS access.
export interface DailyForecast {
  date: string;
  eto_mm: number;
  rain_mm: number;
  temp_c: number;
}

export interface WeatherBundle {
  forecast: DailyForecast[]; // next 7 days
  history: DailyForecast[];  // previous 7 days
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherBundle | null> {
  const today = new Date();
  const past = new Date(today.getTime() - 7 * 86400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const fcUrl = new URL("https://api.open-meteo.com/v1/forecast");
  fcUrl.searchParams.set("latitude", lat.toFixed(4));
  fcUrl.searchParams.set("longitude", lon.toFixed(4));
  fcUrl.searchParams.set(
    "daily",
    "et0_fao_evapotranspiration,precipitation_sum,temperature_2m_mean",
  );
  fcUrl.searchParams.set("timezone", "auto");
  fcUrl.searchParams.set("forecast_days", "7");

  const histUrl = new URL("https://archive-api.open-meteo.com/v1/era5");
  histUrl.searchParams.set("latitude", lat.toFixed(4));
  histUrl.searchParams.set("longitude", lon.toFixed(4));
  histUrl.searchParams.set("start_date", fmt(past));
  histUrl.searchParams.set("end_date", fmt(new Date(today.getTime() - 86400_000)));
  histUrl.searchParams.set(
    "daily",
    "et0_fao_evapotranspiration,precipitation_sum,temperature_2m_mean",
  );
  histUrl.searchParams.set("timezone", "auto");

  try {
    const [fcResp, histResp] = await Promise.all([fetch(fcUrl.toString()), fetch(histUrl.toString())]);
    if (!fcResp.ok) {
      console.error("Open-Meteo forecast error:", fcResp.status);
      return null;
    }
    const fcJson = (await fcResp.json()) as {
      daily?: {
        time: string[];
        et0_fao_evapotranspiration: number[];
        precipitation_sum: number[];
        temperature_2m_mean: number[];
      };
    };
    if (!fcJson.daily) return null;

    const toDaily = (d: NonNullable<typeof fcJson.daily>): DailyForecast[] =>
      d.time.map((t, i) => ({
        date: t,
        eto_mm: d.et0_fao_evapotranspiration[i] ?? 0,
        rain_mm: d.precipitation_sum[i] ?? 0,
        temp_c: d.temperature_2m_mean[i] ?? 0,
      }));

    let history: DailyForecast[] = [];
    if (histResp.ok) {
      const histJson = (await histResp.json()) as { daily?: typeof fcJson.daily };
      if (histJson.daily) history = toDaily(histJson.daily);
    }
    return { forecast: toDaily(fcJson.daily), history };
  } catch (err) {
    console.error("Open-Meteo fetch failed:", err);
    return null;
  }
}

// ERA5-model NDMI estimate when both Sentinel-2 and Sentinel-1 fail.
// Per spec: ndmi ≈ min((rainfall_mm / 50) - 0.2, 0.4)
export function estimateNdmiFromRain(rainfall_mm: number): number {
  return Math.min(rainfall_mm / 50 - 0.2, 0.4);
}

// ---------- Polygon centroid (for weather lookup) ----------
export function polygonCentroid(geom: GeoJSON.Polygon): { lat: number; lon: number } | null {
  const ring = geom?.coordinates?.[0];
  if (!ring || ring.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
    n++;
  }
  if (n === 0) return null;
  return { lat: sy / n, lon: sx / n };
}

// ---------- FAO-56 dose computation ----------
function ndmiMultiplier(ndmi: number): number {
  if (ndmi > 0.3) return 0;
  if (ndmi > 0.2) return 0.4;
  if (ndmi > 0) return 0.7;
  return 1.0;
}

function statusFor(ndmi: number): "green" | "yellow" | "red" {
  if (ndmi > 0.2) return "green";
  if (ndmi > 0) return "yellow";
  return "red";
}

export interface DailyDose extends DailyForecast {
  etc_mm: number;
  dose_mm: number;
  status: "green" | "yellow" | "red";
}

export interface RecommendationResult {
  ndmi: number;
  status: "green" | "yellow" | "red";
  reason: string;
  dose_mm: number;
  eto_mm: number;
  rainfall_mm: number;
  forecast: DailyDose[];
}

export function computeRecommendation(args: {
  ndmi: number;
  kc: number;
  forecast: DailyForecast[];
}): RecommendationResult {
  const { ndmi, kc, forecast } = args;

  const m = ndmiMultiplier(ndmi);
  const baseStatus = statusFor(ndmi);

  // Per-day computation; weekly dose = ETc × 7 × multiplier (per spec)
  const totalEto = forecast.reduce((s, d) => s + d.eto_mm, 0);
  const totalRain = forecast.reduce((s, d) => s + d.rain_mm, 0);
  const meanEto = forecast.length ? totalEto / forecast.length : 4.5;
  const weeklyDose = Math.round(meanEto * kc * 7 * m);

  // Per-day forecast doses (for the 7-day chart). Shift status if a heavy rain
  // day suppresses the need for irrigation.
  const dailyDoses: DailyDose[] = forecast.map((d) => {
    const etc = d.eto_mm * kc;
    const dayDose = Math.max(0, Math.round(etc * m - d.rain_mm));
    let st: "green" | "yellow" | "red" = baseStatus;
    if (dayDose === 0) st = "green";
    else if (dayDose < etc * 0.5) st = "yellow";
    return {
      ...d,
      etc_mm: Number(etc.toFixed(2)),
      dose_mm: dayDose,
      status: st,
    };
  });

  let reason: string;
  if (baseStatus === "green") reason = "Без напояване. Влагата в листата е достатъчна (NDMI > 0.2).";
  else if (baseStatus === "yellow") reason = "Умерено напояване. NDMI показва лек воден стрес.";
  else reason = "Спешно напояване. Силен воден стрес (NDMI ≤ 0).";

  return {
    ndmi,
    status: baseStatus,
    reason: `${reason} 7-дневна нужда: ~${weeklyDose} mm.`,
    dose_mm: weeklyDose,
    eto_mm: Number(meanEto.toFixed(2)),
    rainfall_mm: Number(totalRain.toFixed(1)),
    forecast: dailyDoses,
  };
}

// ---------- Top-level pipeline ----------
export interface PipelineResult {
  ndmi: number;
  ndvi: number;
  source: DataSource;
  confidence: number;
  cloudCoverage: number;
  rainfall_mm: number;
  eto: number;
  dose_mm: number;
  status: "green" | "yellow" | "red";
  reason: string;
  forecast: DailyDose[];
}

export async function runPipeline(args: {
  geometry: GeoJSON.Polygon;
  centroid: { lat: number; lon: number };
  crop?: string | null;
  phase?: string | null;
}): Promise<PipelineResult> {
  const { geometry, centroid, crop, phase } = args;
  const today = new Date();
  const dateTo = today.toISOString();
  const dateFrom = new Date(today.getTime() - 14 * 86400_000).toISOString();

  // Weather is needed by every branch — fetch in parallel with S2.
  const weatherPromise = fetchWeather(centroid.lat, centroid.lon);

  let source: DataSource = "era5-model";
  let confidence = 65;
  let cloudCoverage = 100;
  let ndmi: number | null = null;
  let ndvi = 0.55;

  // STEP 1 — Sentinel-2 optical
  const s2 = await fetchSentinel2(geometry, dateFrom, dateTo);
  if (s2 && s2.cloudCoverage < 30 && Number.isFinite(s2.ndmi)) {
    source = "sentinel-2";
    confidence = 90;
    cloudCoverage = s2.cloudCoverage;
    ndmi = s2.ndmi;
    ndvi = s2.ndvi;
  } else if (s2) {
    cloudCoverage = s2.cloudCoverage;
  }

  // STEP 2 — Sentinel-1 SAR fallback
  if (ndmi === null) {
    const s1 = await fetchSentinel1Sar(geometry, dateFrom, dateTo);
    if (s1 && Number.isFinite(s1.ndmiProxy)) {
      source = "sentinel-1-sar";
      confidence = 75;
      ndmi = s1.ndmiProxy;
    }
  }

  // STEP 3 — ERA5 / Open-Meteo fallback
  const weather = await weatherPromise;
  const histRain = weather?.history.reduce((s, d) => s + d.rain_mm, 0) ?? 0;
  if (ndmi === null) {
    source = "era5-model";
    confidence = 65;
    ndmi = estimateNdmiFromRain(histRain);
  }

  const forecastDaily: DailyForecast[] = weather?.forecast ?? [];
  const kc = getKc(crop, phase);
  const rec = computeRecommendation({ ndmi, kc, forecast: forecastDaily });

  return {
    ndmi: Number(ndmi.toFixed(3)),
    ndvi: Number(ndvi.toFixed(3)),
    source,
    confidence,
    cloudCoverage: Math.round(cloudCoverage),
    rainfall_mm: Number(histRain.toFixed(1)),
    eto: rec.eto_mm,
    dose_mm: rec.dose_mm,
    status: rec.status,
    reason: rec.reason,
    forecast: rec.forecast,
  };
}
