// On-demand NDMI fetch — called from the parcel detail panel when a parcel
// is selected. Runs the full multi-source pipeline and persists results.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { polygonCentroid, runPipeline } from "@/integrations/agri/fao56";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface RequestBody {
  parcel_id: string;
  geometry?: GeoJSON.Polygon;
}

export const Route = createFileRoute("/api/fetch-ndmi")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as RequestBody;
          if (!body.parcel_id) {
            return Response.json(
              { error: "parcel_id is required" },
              { status: 400, headers: CORS },
            );
          }

          // Load parcel from DB (geometry, crop, phase). Client may pass
          // geometry too, but DB is source of truth.
          const { data: parcel, error: pErr } = await supabaseAdmin
            .from("parcels")
            .select("id, geometry, crop_type, growth_phase")
            .eq("id", body.parcel_id)
            .single();
          if (pErr || !parcel) {
            return Response.json(
              { error: pErr?.message ?? "parcel not found" },
              { status: 404, headers: CORS },
            );
          }

          let geom: GeoJSON.Polygon | null = null;
          try {
            geom =
              typeof parcel.geometry === "string"
                ? (JSON.parse(parcel.geometry) as GeoJSON.Polygon)
                : (parcel.geometry as unknown as GeoJSON.Polygon);
          } catch {
            geom = body.geometry ?? null;
          }
          if (!geom || geom.type !== "Polygon") {
            return Response.json(
              { error: "invalid geometry" },
              { status: 400, headers: CORS },
            );
          }
          const centroid = polygonCentroid(geom);
          if (!centroid) {
            return Response.json(
              { error: "cannot compute centroid" },
              { status: 400, headers: CORS },
            );
          }

          const r = await runPipeline({
            geometry: geom,
            centroid,
            crop: parcel.crop_type,
            phase: parcel.growth_phase,
          });

          // Persist (best-effort — don't fail the request if RLS blocks)
          await supabaseAdmin.from("ndmi_readings").insert([
            {
              parcel_id: parcel.id,
              ndmi_value: r.ndmi,
              ndvi_value: r.ndvi,
              source: r.source,
              data_source: r.source,
              confidence_pct: r.confidence,
              cloud_coverage: r.cloudCoverage,
              rainfall_mm: r.rainfall_mm,
              eto_value: r.eto,
            } as never,
          ]);

          const validUntil = new Date(Date.now() + 7 * 86400_000).toISOString();
          const { data: rec } = await supabaseAdmin
            .from("irrigation_recommendations")
            .insert([
              {
                parcel_id: parcel.id,
                dose_mm: r.dose_mm,
                status: r.status,
                reason: r.reason,
                valid_until: validUntil,
                forecast_json: r.forecast as unknown as never,
                data_source: r.source,
                confidence_pct: r.confidence,
              } as never,
            ])
            .select()
            .single();

          return Response.json(
            {
              ndmi: r.ndmi,
              ndvi: r.ndvi,
              source: r.source,
              confidence: r.confidence,
              cloudCoverage: r.cloudCoverage,
              rainfall_mm: r.rainfall_mm,
              eto: r.eto,
              dose_mm: r.dose_mm,
              status: r.status,
              reason: r.reason,
              forecast: r.forecast,
              recommendation_id: rec?.id,
            },
            { headers: CORS },
          );
        } catch (err) {
          console.error("fetch-ndmi error:", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Unknown error" },
            { status: 500, headers: CORS },
          );
        }
      },
    },
  },
});
