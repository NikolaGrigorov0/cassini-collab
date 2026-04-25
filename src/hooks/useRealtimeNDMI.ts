import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeStatus } from "./useRealtimeRecommendations";

export interface RealtimeNDMI {
  id: string;
  parcel_id: string;
  ndmi_value: number;
  ndvi_value: number;
  data_source: string | null;
  confidence_pct: number | null;
  cloud_coverage: number | null;
  rainfall_mm: number | null;
  recorded_at: string;
}

export function useRealtimeNDMI(parcelId: string | null) {
  const [latest, setLatest] = useState<RealtimeNDMI | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");

  useEffect(() => {
    if (!parcelId) {
      setLatest(null);
      setStatus("disconnected");
      return;
    }
    let cancelled = false;
    setStatus("connecting");

    (async () => {
      const { data } = await supabase
        .from("ndmi_readings")
        .select("id, parcel_id, ndmi_value, ndvi_value, data_source, confidence_pct, cloud_coverage, rainfall_mm, recorded_at")
        .eq("parcel_id", parcelId)
        .order("recorded_at", { ascending: false })
        .limit(1);
      if (!cancelled && data && data[0]) {
        setLatest(data[0] as unknown as RealtimeNDMI);
      }
    })();

    const channel = supabase
      .channel(`ndmi-${parcelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ndmi_readings",
          filter: `parcel_id=eq.${parcelId}`,
        },
        (payload) => {
          setLatest(payload.new as unknown as RealtimeNDMI);
        },
      )
      .subscribe((s) => {
        if (s === "SUBSCRIBED") setStatus("connected");
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
          setStatus("disconnected");
        }
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [parcelId]);

  return { latest, status };
}
