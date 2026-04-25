// Soil & topography enrichment for a parcel.
// Calls SoilGrids (ISRIC) for sand/clay/silt and OpenTopography for elevation+slope.
// Persists results back onto the parcels row.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { polygonCentroid } from "@/integrations/agri/fao56";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface ReqBody { parcel_id: string }

// SoilGrids REST: returns mean values for sand/clay/silt + pH + organic carbon.
// Docs: https://rest.isric.org/soilgrids/v2.0/docs
// IMPORTANT: SoilGrids depths are 0-5cm, 5-15cm, 15-30cm, 30-60cm, 60-100cm,
// 100-200cm. There is NO "0-30cm" — passing it returns an empty layers array.
// We request the top three (0-5, 5-15, 15-30) and average them for the root zone.
async function fetchSoilGridsAt(lat: number, lon: number) {
  const url =
    `https://rest.isric.org/soilgrids/v2.0/properties/query?lat=${lat}&lon=${lon}` +
    `&property=sand&property=clay&property=silt&property=phh2o&property=soc` +
    `&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`SoilGrids ${r.status}`);
  const j = (await r.json()) as {
    properties?: { layers?: Array<{ name: string; depths?: Array<{ values?: { mean?: number } }> }> };
  };
  const layers = j.properties?.layers ?? [];
  // SoilGrids returns d_factor scaled values. Texture is g/kg ×10 so /10 → %.
  // pH is pH × 10. SOC is dg/kg (i.e. g/kg × 10).
  // Average across the top three depths to get a 0–30cm root-zone value.
  const raw = (name: string): number | null => {
    const l = layers.find((x) => x.name === name);
    const means = (l?.depths ?? [])
      .map((d) => d?.values?.mean)
      .filter((v): v is number => typeof v === "number");
    if (means.length === 0) return null;
    return means.reduce((a, b) => a + b, 0) / means.length;
  };
  const pct = (name: string): number | null => {
    const v = raw(name);
    return v == null ? null : v / 10;
  };
  return {
    sand: pct("sand"),
    clay: pct("clay"),
    silt: pct("silt"),
    ph: (() => {
      const v = raw("phh2o");
      return v == null ? null : Math.round((v / 10) * 100) / 100;
    })(),
    soc: pct("soc"), // dg/kg ÷ 10 → g/kg (agronomic units)
  };
}

function classifySoil(clay: number | null, sand: number | null, silt: number | null): string {
  if (clay == null && sand == null && silt == null) return "Неизвестна";
  if ((clay ?? 0) > 40) return "Глинеста";
  if ((sand ?? 0) > 70) return "Песъчлива";
  if ((silt ?? 0) > 50) return "Льосова";
  return "Средна (loam)";
}

function bboxOf(geom: GeoJSON.Polygon): [number, number, number, number] {
  const ring = geom.coordinates[0] as [number, number][];
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [x, y] of ring) {
    if (x < minLon) minLon = x;
    if (x > maxLon) maxLon = x;
    if (y < minLat) minLat = y;
    if (y > maxLat) maxLat = y;
  }
  return [minLon, minLat, maxLon, maxLat];
}

// OpenTopography Global DEM API — returns elevation in meters.
// Docs: https://portal.opentopography.org/apidocs/
// We sample 5 points (centroid + 4 around) to compute slope via finite differences.
async function fetchElevation(lat: number, lon: number): Promise<number | null> {
  const url = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) return null;
  const j = await r.json() as { results?: Array<{ elevation?: number }> };
  return j.results?.[0]?.elevation ?? null;
}

async function fetchSlope(lat: number, lon: number): Promise<{ slope: number | null; aspect: number | null; elevation: number | null }> {
  // Sample 5 points: center + N/S/E/W ~30m offsets (~0.00027 deg)
  const d = 0.00027;
  const pts = [
    [lat, lon],
    [lat + d, lon], // N
    [lat - d, lon], // S
    [lat, lon + d], // E
    [lat, lon - d], // W
  ];
  const locs = pts.map((p) => `${p[0]},${p[1]}`).join("|");
  try {
    const r = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${locs}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      const e = await fetchElevation(lat, lon);
      return { slope: null, aspect: null, elevation: e };
    }
    const j = await r.json() as { results?: Array<{ elevation?: number }> };
    const z = (j.results ?? []).map((x) => x.elevation ?? 0);
    if (z.length < 5) return { slope: null, aspect: null, elevation: z[0] ?? null };
    const [, zN, zS, zE, zW] = z;
    // Approx 30m horizontal distance between samples
    const dx = 30 * 2;
    const dz_dx = (zE - zW) / dx; // east positive
    const dz_dy = (zN - zS) / dx; // north positive
    const slope = (Math.atan(Math.sqrt(dz_dx * dz_dx + dz_dy * dz_dy)) * 180) / Math.PI;
    let aspect = (Math.atan2(dz_dy, -dz_dx) * 180) / Math.PI;
    if (aspect < 0) aspect += 360;
    return { slope, aspect, elevation: z[0] };
  } catch {
    return { slope: null, aspect: null, elevation: null };
  }
}

// Saxton-Rawls (simplified) AWC mm per meter of soil = (FC - WP) * 1000
// FC ≈ 0.2576 - 0.002*sand + 0.0036*clay + 0.0299*om
// WP ≈ 0.026 + 0.005*clay + 0.0158*om
// We assume om=2% (organic matter) and 1m rooting depth -> AWC mm.
function computeAWCmm(sandPct: number | null, clayPct: number | null): number | null {
  if (sandPct == null || clayPct == null) return null;
  const om = 2;
  const fc = 0.2576 - 0.002 * sandPct + 0.0036 * clayPct + 0.0299 * om;
  const wp = 0.026 + 0.005 * clayPct + 0.0158 * om;
  const awc = Math.max(0, fc - wp) * 1000; // 1m depth in mm
  return Math.round(awc);
}

export const Route = createFileRoute("/api/enrich-soil")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as ReqBody;
          if (!body.parcel_id) {
            return Response.json({ error: "parcel_id required" }, { status: 400, headers: CORS });
          }
          const { data: parcel, error } = await supabaseAdmin
            .from("parcels")
            .select("id, geometry, soil_enriched_at")
            .eq("id", body.parcel_id)
            .single();
          if (error || !parcel) {
            return Response.json({ error: error?.message ?? "not found" }, { status: 404, headers: CORS });
          }
          let geom: GeoJSON.Polygon;
          try {
            geom = typeof parcel.geometry === "string"
              ? JSON.parse(parcel.geometry) as GeoJSON.Polygon
              : parcel.geometry as unknown as GeoJSON.Polygon;
          } catch {
            return Response.json({ error: "invalid geometry" }, { status: 400, headers: CORS });
          }
          const centroid = polygonCentroid(geom);
          if (!centroid) {
            return Response.json({ error: "could not compute centroid" }, { status: 400, headers: CORS });
          }
          const { lat, lon } = centroid;

          // Sample 3 points: centroid + bbox top-left + bbox bottom-right.
          const [minLon, minLat, maxLon, maxLat] = bboxOf(geom);
          const samplePts = [
            { name: "centroid", lat, lon },
            { name: "top-left", lat: maxLat, lon: minLon },
            { name: "bottom-right", lat: minLat, lon: maxLon },
          ];
          const [topo, ...soilSamples] = await Promise.all([
            fetchSlope(lat, lon).catch(() => ({ slope: null, aspect: null, elevation: null })),
            ...samplePts.map((p) =>
              fetchSoilGridsAt(p.lat, p.lon).catch(() => ({
                sand: null, clay: null, silt: null, ph: null, soc: null,
              })),
            ),
          ]);

          // Classify each sample, build the soil_type label.
          const types = soilSamples.map((s) => classifySoil(s.clay, s.sand, s.silt));
          const uniqueTypes = Array.from(new Set(types.filter((t) => t !== "Неизвестна")));
          const soil_type =
            uniqueTypes.length === 0
              ? "Неизвестна"
              : uniqueTypes.length === 1
                ? uniqueTypes[0]
                : `Смесена: ${uniqueTypes.join(" + ")}`;

          // Average non-null values across samples for texture/ph/soc.
          const avg = (vals: Array<number | null>) => {
            const v = vals.filter((x): x is number => typeof x === "number");
            if (v.length === 0) return null;
            return v.reduce((a, b) => a + b, 0) / v.length;
          };
          const sand = avg(soilSamples.map((s) => s.sand));
          const clay = avg(soilSamples.map((s) => s.clay));
          const silt = avg(soilSamples.map((s) => s.silt));
          const ph = avg(soilSamples.map((s) => s.ph));
          const soc = avg(soilSamples.map((s) => s.soc));

          const awc_mm = computeAWCmm(sand, clay);

          const update = {
            soil_sand_pct: sand,
            soil_clay_pct: clay,
            soil_silt_pct: silt,
            soil_type,
            soil_ph: ph == null ? null : Number(ph.toFixed(2)),
            soil_organic_carbon: soc == null ? null : Number(soc.toFixed(2)),
            soil_data_raw: { samples: samplePts.map((p, i) => ({ ...p, ...soilSamples[i], type: types[i] })) },
            awc_mm,
            slope_deg: topo.slope,
            aspect_deg: topo.aspect,
            elevation_m: topo.elevation,
            soil_enriched_at: new Date().toISOString(),
          };
          const { error: upErr } = await supabaseAdmin
            .from("parcels")
            .update(update)
            .eq("id", parcel.id);
          if (upErr) {
            return Response.json({ error: upErr.message }, { status: 500, headers: CORS });
          }
          return Response.json({ ok: true, ...update }, { headers: CORS });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          return Response.json({ error: msg }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
