// Per-parcel NDMI heatmap raster.
// Calls Sentinel Hub Process API with the parcel polygon and returns a PNG
// (base64 dataURL) coloured by NDMI = (B08 - B11) / (B08 + B11).
// The image is masked to the polygon (transparent outside) so the client can
// drop it on the map as an image overlay.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSentinelToken } from "@/integrations/agri/fao56";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface RequestBody {
  parcel_id: string;
}

// Evalscript: NDVI coloured PNG, transparent outside the polygon.
// NDVI = (NIR - Red) / (NIR + Red) using Sentinel-2 B08 (NIR) + B04 (Red).
// SH automatically clips the response to the input geometry — pixels outside
// the polygon arrive as dataMask=0 → we set alpha=0 there.
const NDVI_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "dataMask"] }],
    output: { bands: 4, sampleType: "AUTO" }
  };
}

// NDVI -> RGB ramp (bare/stressed red → sparse yellow → vigorous dark green)
function ramp(v) {
  // NDVI typically ranges 0..0.9 for vegetation; clamp to [0, 0.9]
  const t = Math.max(0, Math.min(1, v / 0.9));
  // 5-stop palette tuned for vegetation vigor differences
  const stops = [
    [0.00, [165,  42,  42]],  // bare soil / very stressed
    [0.25, [220,  38,  38]],  // stressed
    [0.50, [234, 179,   8]],  // sparse
    [0.75, [ 22, 163,  74]],  // healthy
    [1.00, [ 20,  83,  45]],  // very vigorous
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i];
      const f = (t - a[0]) / (b[0] - a[0]);
      return [
        a[1][0] + (b[1][0] - a[1][0]) * f,
        a[1][1] + (b[1][1] - a[1][1]) * f,
        a[1][2] + (b[1][2] - a[1][2]) * f,
      ];
    }
  }
  return stops[stops.length - 1][1];
}

function evaluatePixel(s) {
  if (s.dataMask === 0) return [0, 0, 0, 0];
  const denom = s.B08 + s.B04;
  if (denom === 0) return [0, 0, 0, 0];
  const ndvi = (s.B08 - s.B04) / denom;
  const c = ramp(ndvi);
  return [c[0] / 255, c[1] / 255, c[2] / 255, 1];
}`;

function bboxFromPolygon(geom: GeoJSON.Polygon): [number, number, number, number] {
  const ring = geom.coordinates[0] as [number, number][];
  const lons = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

// Approximate metres per pixel at given latitude → derive image size for ~10m/pixel.
function dimsForBbox(bbox: [number, number, number, number]): { width: number; height: number } {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((midLat * Math.PI) / 180);
  const widthM = (maxLon - minLon) * mPerDegLon;
  const heightM = (maxLat - minLat) * mPerDegLat;
  // 10 m per pixel native, clamp to safety bounds
  const width = Math.max(64, Math.min(2048, Math.round(widthM / 10)));
  const height = Math.max(64, Math.min(2048, Math.round(heightM / 10)));
  return { width, height };
}

export const Route = createFileRoute("/api/parcel-moisture-raster")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as RequestBody;
          if (!body.parcel_id) {
            return Response.json({ error: "parcel_id is required" }, { status: 400, headers: CORS });
          }

          const { data: parcel, error: pErr } = await supabaseAdmin
            .from("parcels")
            .select("id, geometry")
            .eq("id", body.parcel_id)
            .single();
          if (pErr || !parcel) {
            return Response.json({ error: pErr?.message ?? "parcel not found" }, { status: 404, headers: CORS });
          }

          let geom: GeoJSON.Polygon | null = null;
          try {
            geom = typeof parcel.geometry === "string"
              ? (JSON.parse(parcel.geometry) as GeoJSON.Polygon)
              : (parcel.geometry as unknown as GeoJSON.Polygon);
          } catch {
            geom = null;
          }
          if (!geom || geom.type !== "Polygon") {
            return Response.json({ error: "invalid geometry" }, { status: 400, headers: CORS });
          }

          const token = await getSentinelToken();
          if (!token) {
            return Response.json(
              { error: "Sentinel Hub credentials not configured" },
              { status: 503, headers: CORS },
            );
          }

          const bbox = bboxFromPolygon(geom);
          const { width, height } = dimsForBbox(bbox);

          // Look back 30 days for the most recent low-cloud Sentinel-2 scene.
          const to = new Date();
          const from = new Date(to.getTime() - 30 * 86400_000);

          const processBody = {
            input: {
              bounds: {
                geometry: geom,
                properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
              },
              data: [
                {
                  type: "sentinel-2-l2a",
                  dataFilter: {
                    timeRange: {
                      from: from.toISOString(),
                      to: to.toISOString(),
                    },
                    maxCloudCoverage: 40,
                    mosaickingOrder: "leastCC",
                  },
                },
              ],
            },
            output: {
              width,
              height,
              responses: [{ identifier: "default", format: { type: "image/png" } }],
            },
            evalscript: NDVI_EVALSCRIPT,
          };

          const resp = await fetch("https://services.sentinel-hub.com/api/v1/process", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              Accept: "image/png",
            },
            body: JSON.stringify(processBody),
          });

          if (!resp.ok) {
            const txt = await resp.text();
            console.error("SH Process API error:", resp.status, txt);
            return Response.json(
              { error: `Sentinel Hub error ${resp.status}`, details: txt.slice(0, 400) },
              { status: 502, headers: CORS },
            );
          }

          const buf = new Uint8Array(await resp.arrayBuffer());
          // Base64-encode for JSON transport (image is small; 10m/px on a few-hectare parcel ≈ a few KB).
          let bin = "";
          for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
          const dataUrl = `data:image/png;base64,${btoa(bin)}`;

          return Response.json(
            {
              parcel_id: parcel.id,
              bbox, // [minLon, minLat, maxLon, maxLat]
              width,
              height,
              image: dataUrl,
              acquired_window: { from: from.toISOString(), to: to.toISOString() },
            },
            { headers: CORS },
          );
        } catch (err) {
          console.error("parcel-moisture-raster error:", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Unknown error" },
            { status: 500, headers: CORS },
          );
        }
      },
    },
  },
});
