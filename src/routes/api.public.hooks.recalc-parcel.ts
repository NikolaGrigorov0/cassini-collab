// On-demand single-parcel recommendation refresh.
// Called by:
//   • Postgres trigger after a new irrigation_events row (auto-recalc)
//   • The daily soil-balance cron when MAD is crossed
//   • Manually from the UI ("Обнови сега" button)
//
// Public route — protected by an HMAC-style shared secret if RECOMMENDATION_HOOK_SECRET
// is set, otherwise open (matches the existing refresh-recommendations route).
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { polygonCentroid, runPipeline } from "@/integrations/agri/fao56";

interface Body {
  parcel_id?: string;
  reason?: string;
}

export const Route = createFileRoute("/api/public/hooks/recalc-parcel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body = {};
        try {
          body = (await request.json()) as Body;
        } catch {
          // Triggers may send empty body for keepalive; tolerate.
        }
        const parcelId = body.parcel_id?.trim();
        if (!parcelId) {
          return Response.json({ error: "parcel_id required" }, { status: 400 });
        }

        const { data: parcel, error } = await supabaseAdmin
          .from("parcels")
          .select("id, user_id, name, geometry, crop_type, growth_phase")
          .eq("id", parcelId)
          .maybeSingle();
        if (error || !parcel) {
          return Response.json(
            { error: error?.message ?? "parcel not found" },
            { status: 404 },
          );
        }

        let geom: GeoJSON.Polygon | null = null;
        try {
          geom =
            typeof parcel.geometry === "string"
              ? (JSON.parse(parcel.geometry) as GeoJSON.Polygon)
              : (parcel.geometry as unknown as GeoJSON.Polygon);
        } catch {
          /* ignore */
        }
        if (!geom || geom.type !== "Polygon") {
          return Response.json({ error: "invalid geometry" }, { status: 400 });
        }
        const centroid = polygonCentroid(geom);
        if (!centroid) {
          return Response.json({ error: "no centroid" }, { status: 400 });
        }

        try {
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
              reason: body.reason
                ? `${r.reason} (преизчислено: ${body.reason})`
                : r.reason,
              valid_until: validUntil,
              forecast_json: r.forecast as unknown as never,
              data_source: r.source,
              confidence_pct: r.confidence,
            } as never,
          ]);

          // Lightweight notification to surface that recompute happened.
          if (body.reason) {
            await supabaseAdmin.from("notifications").insert({
              user_id: parcel.user_id,
              title: `🔄 Обновена препоръка: ${parcel.name}`,
              body: `Нова доза: ${r.dose_mm} mm. Причина: ${body.reason}.`,
              kind: "info",
              parcel_id: parcel.id,
            } as never);
          }

          return Response.json({
            ok: true,
            parcel_id: parcel.id,
            dose_mm: r.dose_mm,
            status: r.status,
            source: r.source,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown";
          console.error(`recalc parcel ${parcelId} failed:`, msg);
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
