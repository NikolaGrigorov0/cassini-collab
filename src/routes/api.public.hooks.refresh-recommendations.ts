// Daily cron endpoint — called by pg_cron at 00:00 UTC.
// Loops through all parcels and runs the multi-source NDMI pipeline.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { polygonCentroid, runPipeline } from "@/integrations/agri/fao56";

export const Route = createFileRoute("/api/public/hooks/refresh-recommendations")({
  server: {
    handlers: {
      POST: async () => {
        const startedAt = Date.now();

        const { data: parcels, error: pErr } = await supabaseAdmin
          .from("parcels")
          .select("id, geometry, crop_type, growth_phase");
        if (pErr) {
          console.error("parcels query failed:", pErr);
          return Response.json({ error: pErr.message }, { status: 500 });
        }

        const results: Array<{ parcel_id: string; ok: boolean; source?: string; error?: string }> = [];

        for (const parcel of parcels ?? []) {
          try {
            let geom: GeoJSON.Polygon | null = null;
            try {
              geom =
                typeof parcel.geometry === "string"
                  ? (JSON.parse(parcel.geometry) as GeoJSON.Polygon)
                  : (parcel.geometry as unknown as GeoJSON.Polygon);
            } catch {
              geom = null;
            }
            if (!geom || geom.type !== "Polygon") {
              results.push({ parcel_id: parcel.id, ok: false, error: "invalid geometry" });
              continue;
            }
            const centroid = polygonCentroid(geom);
            if (!centroid) {
              results.push({ parcel_id: parcel.id, ok: false, error: "no centroid" });
              continue;
            }

            const r = await runPipeline({
              geometry: geom,
              centroid,
              crop: parcel.crop_type,
              phase: parcel.growth_phase,
            });

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
            await supabaseAdmin.from("irrigation_recommendations").insert([
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
            ]);

            results.push({ parcel_id: parcel.id, ok: true, source: r.source });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "unknown";
            console.error(`parcel ${parcel.id} failed:`, msg);
            results.push({ parcel_id: parcel.id, ok: false, error: msg });
          }
        }

        return Response.json({
          processed: results.length,
          ok: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
          duration_ms: Date.now() - startedAt,
          results,
        });
      },
    },
  },
});
