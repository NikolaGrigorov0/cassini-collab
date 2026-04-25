// Daily soil-moisture balance — called by pg_cron at 04:00 UTC.
//
// For every parcel:
//   1. Read yesterday's balance from soil_moisture_daily (or seed at 60% AWC).
//   2. Read today's ETo + rain from Open-Meteo (FAO-56), today's NDVI from
//      latest ndmi_readings, and today's irrigation events.
//   3. Compute new balance + moisture %.
//   4. Insert today's row into soil_moisture_daily.
//   5. If moisturePct just crossed below the MAD threshold of the parcel's
//      current phenophase, create one-shot inbox notification.
//
// We also maintain a "freshly created recommendation when below MAD" so the
// dashboard updates without waiting for the morning Sentinel cron.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  fetchWeather,
  polygonCentroid,
  getKc,
} from "@/integrations/agri/fao56";
import {
  computeDailyBalance,
  isBelowMad,
  DEFAULT_AWC_MM,
} from "@/lib/soilBalance";

interface ParcelRow {
  id: string;
  user_id: string;
  name: string;
  crop_type: string;
  growth_phase: string | null;
  geometry: string;
  awc_mm: number | null;
}

interface NdmiRow {
  parcel_id: string;
  ndvi_value: number;
}

interface PhenoRow {
  crop_type: string;
  order_index: number;
  mad_threshold: number;
  phase_name: string;
  kc_base: number;
}

interface IrrigRow {
  parcel_id: string;
  amount_mm: number;
  method: string;
}

interface SmRow {
  parcel_id: string;
  date: string;
  balance_mm: number | null;
  moisture_pct: number | null;
}

export const Route = createFileRoute("/api/public/hooks/daily-soil-balance")({
  server: {
    handlers: {
      POST: async () => {
        const startedAt = Date.now();
        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);
        const yesterdayStr = new Date(today.getTime() - 86400_000)
          .toISOString()
          .slice(0, 10);

        const { data: parcelsRaw, error: pErr } = await supabaseAdmin
          .from("parcels")
          .select("id, user_id, name, crop_type, growth_phase, geometry, awc_mm");
        if (pErr) {
          console.error("parcels query failed:", pErr);
          return Response.json({ error: pErr.message }, { status: 500 });
        }
        const parcels = (parcelsRaw ?? []) as unknown as ParcelRow[];
        const parcelIds = parcels.map((p) => p.id);

        if (parcelIds.length === 0) {
          return Response.json({ processed: 0, message: "no parcels" });
        }

        // Bulk-load yesterday's balance, today's irrigation events, latest NDVI,
        // and the phenophases catalog in parallel.
        const [smRes, irrRes, ndmiRes, phenoRes] = await Promise.all([
          supabaseAdmin
            .from("soil_moisture_daily")
            .select("parcel_id, date, balance_mm, moisture_pct")
            .in("parcel_id", parcelIds)
            .order("date", { ascending: false }),
          supabaseAdmin
            .from("irrigation_events")
            .select("parcel_id, amount_mm, method")
            .in("parcel_id", parcelIds)
            .eq("date", todayStr),
          supabaseAdmin
            .from("ndmi_readings")
            .select("parcel_id, ndvi_value")
            .in("parcel_id", parcelIds)
            .order("recorded_at", { ascending: false }),
          supabaseAdmin
            .from("phenophases")
            .select("crop_type, order_index, mad_threshold, phase_name, kc_base"),
        ]);

        const smByParcel = new Map<string, SmRow>();
        for (const row of (smRes.data ?? []) as unknown as SmRow[]) {
          if (!smByParcel.has(row.parcel_id)) smByParcel.set(row.parcel_id, row);
        }

        const irrByParcel = new Map<string, number>();
        for (const row of (irrRes.data ?? []) as unknown as IrrigRow[]) {
          if (row.method === "rain") continue; // rain comes from weather feed
          irrByParcel.set(
            row.parcel_id,
            (irrByParcel.get(row.parcel_id) ?? 0) + Number(row.amount_mm),
          );
        }

        const ndviByParcel = new Map<string, number>();
        for (const row of (ndmiRes.data ?? []) as unknown as NdmiRow[]) {
          if (!ndviByParcel.has(row.parcel_id)) {
            ndviByParcel.set(row.parcel_id, Number(row.ndvi_value));
          }
        }

        const phenoByCrop = new Map<string, PhenoRow[]>();
        for (const row of (phenoRes.data ?? []) as unknown as PhenoRow[]) {
          const list = phenoByCrop.get(row.crop_type) ?? [];
          list.push(row);
          phenoByCrop.set(row.crop_type, list);
        }
        for (const list of phenoByCrop.values()) {
          list.sort((a, b) => a.order_index - b.order_index);
        }

        const results: Array<{
          parcel_id: string;
          ok: boolean;
          moisture_pct?: number;
          below_mad?: boolean;
          notified?: boolean;
          error?: string;
        }> = [];

        for (const parcel of parcels) {
          try {
            // --- Geometry & weather
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

            const weather = await fetchWeather(centroid.lat, centroid.lon);
            // Use today's row from the forecast bundle (forecast[0] = today).
            const todayWx = weather?.forecast?.[0];
            const etoMm = todayWx?.eto_mm ?? 0;
            const rainMm = todayWx?.rain_mm ?? 0;

            // --- Kc: dynamic from NDVI if we have it, else phase Kc
            const ndvi = ndviByParcel.get(parcel.id);
            const phases = phenoByCrop.get(parcel.crop_type) ?? [];
            const currentPheno =
              phases.find((p) => p.phase_name === parcel.growth_phase) ??
              phases[0];
            const kcBase = currentPheno?.kc_base ?? getKc(parcel.crop_type, parcel.growth_phase);
            const kc =
              typeof ndvi === "number" && Number.isFinite(ndvi)
                ? Math.max(0.2, Math.min(1.4, 1.25 * ndvi + 0.2))
                : kcBase;

            // --- Previous balance (yesterday's row, or seed at 60% AWC)
            const awcMm = parcel.awc_mm ?? DEFAULT_AWC_MM;
            const prev = smByParcel.get(parcel.id);
            const prevBalance =
              prev && prev.date === yesterdayStr && prev.balance_mm != null
                ? Number(prev.balance_mm)
                : awcMm * 0.6;
            const prevMoisturePct =
              prev && prev.moisture_pct != null ? Number(prev.moisture_pct) : 60;

            // --- Today's irrigation
            const irrigationMm = irrByParcel.get(parcel.id) ?? 0;

            // --- Compute balance
            const result = computeDailyBalance({
              prevBalanceMm: prevBalance,
              awcMm,
              etoMm,
              kc,
              rainMm,
              irrigationMm,
            });

            // --- Persist
            await supabaseAdmin.from("soil_moisture_daily").upsert(
              {
                parcel_id: parcel.id,
                date: todayStr,
                balance_mm: result.balanceMm,
                moisture_pct: result.moisturePct,
                et_mm: result.etcMm,
                rain_mm: rainMm,
              } as never,
              { onConflict: "parcel_id,date" } as never,
            );

            // --- MAD threshold notification (one-shot when crossing)
            const madThreshold = currentPheno?.mad_threshold ?? 0.5;
            const wasBelow = isBelowMad(prevMoisturePct, madThreshold);
            const nowBelow = isBelowMad(result.moisturePct, madThreshold);
            let notified = false;
            if (nowBelow && !wasBelow) {
              const triggerPct = Math.round((1 - madThreshold) * 100);
              await supabaseAdmin.from("notifications").insert({
                user_id: parcel.user_id,
                title: `⚠️ Полей сега: ${parcel.name}`,
                body: `Влагата падна до ${result.moisturePct}% (праг ${triggerPct}% за фаза „${currentPheno?.phase_name ?? "—"}"). Препоръчваме напояване в следващите 24–48 ч.`,
                kind: "warning",
                parcel_id: parcel.id,
              } as never);
              notified = true;
            }

            results.push({
              parcel_id: parcel.id,
              ok: true,
              moisture_pct: result.moisturePct,
              below_mad: nowBelow,
              notified,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "unknown";
            console.error(`balance for parcel ${parcel.id} failed:`, msg);
            results.push({ parcel_id: parcel.id, ok: false, error: msg });
          }
        }

        return Response.json({
          processed: results.length,
          ok: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
          notified: results.filter((r) => r.notified).length,
          duration_ms: Date.now() - startedAt,
          results,
        });
      },
    },
  },
});
