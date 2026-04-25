import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RealtimeStatus = "connecting" | "connected" | "disconnected";

export interface RealtimeRecommendation {
  id: string;
  parcel_id: string;
  status: string;
  dose_mm: number;
  reason: string;
  data_source: string | null;
  confidence_pct: number | null;
  created_at: string;
}

export function useRealtimeRecommendations(parcelId: string | null) {
  const [latest, setLatest] = useState<RealtimeRecommendation | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");

  useEffect(() => {
    if (!parcelId) {
      setLatest(null);
      setStatus("disconnected");
      return;
    }
    let cancelled = false;
    setStatus("connecting");

    // Initial fetch
    (async () => {
      const { data } = await supabase
        .from("irrigation_recommendations")
        .select("id, parcel_id, status, dose_mm, reason, data_source, confidence_pct, created_at")
        .eq("parcel_id", parcelId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!cancelled && data && data[0]) {
        setLatest(data[0] as unknown as RealtimeRecommendation);
      }
    })();

    const channel = supabase
      .channel(`rec-${parcelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "irrigation_recommendations",
          filter: `parcel_id=eq.${parcelId}`,
        },
        (payload) => {
          setLatest(payload.new as unknown as RealtimeRecommendation);
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
