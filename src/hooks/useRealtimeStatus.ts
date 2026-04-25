// Tracks an overall "is realtime working" status by opening a probe channel.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RealtimeStatus = "connecting" | "connected" | "disconnected";

export function useRealtimeStatus(): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  useEffect(() => {
    const ch = supabase
      .channel("realtime-probe")
      .subscribe((s) => {
        if (s === "SUBSCRIBED") setStatus("connected");
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
          setStatus("disconnected");
        }
      });
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);
  return status;
}
