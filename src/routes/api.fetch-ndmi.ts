// On-demand NDMI fetch — called from the parcel detail panel when a parcel
// is selected. Runs the full multi-source pipeline and persists results.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { polygonCentroid, runPipeline } from "@/integrations/agri/fao56";
import { recalculateAfterIrrigation, recomputeForecast } from "@/lib/irrigationCorrection";

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
            .select("id, geometry, crop_type, growth_phase, soil_type")
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

          // ── Replay today's irrigation/rain events on top of the satellite
          // reading so the farmer's "Полях днес" / "Вали днес" actions stick
          // across refreshes and re-fetches. Without this, every selection of
          // the parcel would overwrite the corrected recommendation with a
          // pure satellite-only one.
          const startOfDay = new Date();
          startOfDay.setHours(0, 0, 0, 0);
          const { data: todaysEvents } = await supabaseAdmin
            .from("irrigation_events")
            .select("amount_mm, dose_mm, method, created_at")
            .eq("parcel_id", parcel.id)
            .eq("undone", false)
            .gte("created_at", startOfDay.toISOString())
            .order("created_at", { ascending: true });

          let finalNdmi = r.ndmi;
          let finalDose = r.dose_mm;
          let finalStatus: "green" | "yellow" | "red" = r.status as "green" | "yellow" | "red";
          let finalReason = r.reason;
          let finalForecast = r.forecast;
          const baselineDose = r.dose_mm;

          if (todaysEvents && todaysEvents.length > 0) {
            for (const ev of todaysEvents) {
              const mm = Number(ev.dose_mm ?? ev.amount_mm ?? 0);
              if (!Number.isFinite(mm) || mm <= 0) continue;
              const ndmiBefore = finalNdmi;
              const corr = recalculateAfterIrrigation(
                finalNdmi,
                mm,
                parcel.crop_type,
                parcel.growth_phase,
                baselineDose,
                parcel.soil_type ?? null,
              );
              const prefix =
                ev.method === "rain"
                  ? `Регистриран валеж ${mm.toFixed(1)}мм. `
                  : "";
              finalNdmi = corr.correctedNDMI;
              finalDose = corr.newDose;
              finalStatus = corr.newStatus;
              finalReason = `${prefix}${corr.newReason}`;
              const updated = recomputeForecast(
                finalForecast.map((d) => ({
                  date: d.date,
                  dose_mm: d.dose_mm,
                  status: d.status as "green" | "yellow" | "red",
                })),
                ndmiBefore,
                corr.correctedNDMI,
                baselineDose,
              );
              // Preserve meteo fields (etc_mm, eto_mm, rain_mm, temp_c) by
              // merging the recomputed dose/status back into the original days.
              finalForecast = finalForecast.map((d, i) => ({
                ...d,
                dose_mm: updated[i]?.dose_mm ?? d.dose_mm,
                status: updated[i]?.status ?? d.status,
              }));
            }
          }

          const dataSource =
            todaysEvents && todaysEvents.length > 0
              ? "post-irrigation-correction"
              : r.source;

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
                dose_mm: finalDose,
                status: finalStatus,
                reason: finalReason,
                valid_until: validUntil,
                forecast_json: finalForecast as unknown as never,
                data_source: dataSource,
                confidence_pct: r.confidence,
              } as never,
            ])
            .select()
            .single();

          return Response.json(
            {
              ndmi: finalNdmi,
              ndvi: r.ndvi,
              source: r.source,
              confidence: r.confidence,
              cloudCoverage: r.cloudCoverage,
              rainfall_mm: r.rainfall_mm,
              eto: r.eto,
              dose_mm: finalDose,
              status: finalStatus,
              reason: finalReason,
              forecast: finalForecast,
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
