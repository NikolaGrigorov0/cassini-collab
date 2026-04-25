// Server function: save a new polygon for an existing parcel.
// Persists the change, writes a parcel_history audit row, and recomputes
// the parcel's area_hectares using turf.area on the server.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import area from "@turf/area";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(4)).min(1),
});

const InputSchema = z.object({
  parcel_id: z.string().uuid(),
  geometry: PolygonSchema,
});

export const updateParcelGeometry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load existing parcel for audit + ownership check (RLS also enforces).
    const { data: existing, error: loadErr } = await supabase
      .from("parcels")
      .select("id, geometry, area_hectares")
      .eq("id", data.parcel_id)
      .single();

    if (loadErr || !existing) {
      throw new Error(loadErr?.message ?? "Парцелът не е намерен");
    }

    // Compute new area in hectares.
    const m2 = area(data.geometry as GeoJSON.Polygon);
    const newAreaHa = Number((m2 / 10000).toFixed(4));

    // Update parcel.
    const newGeometryStr = JSON.stringify(data.geometry);
    const { error: updErr } = await supabase
      .from("parcels")
      .update({ geometry: newGeometryStr, area_hectares: newAreaHa })
      .eq("id", data.parcel_id);
    if (updErr) throw new Error(updErr.message);

    // Audit row.
    const { error: histErr } = await supabase.from("parcel_history").insert({
      parcel_id: data.parcel_id,
      changed_by: userId,
      old_geometry: existing.geometry,
      new_geometry: newGeometryStr,
      old_area_ha: Number(existing.area_hectares),
      new_area_ha: newAreaHa,
    });
    if (histErr) {
      // Non-fatal — log but still succeed.
      console.error("parcel_history insert failed:", histErr);
    }

    return { ok: true, area_hectares: newAreaHa };
  });
