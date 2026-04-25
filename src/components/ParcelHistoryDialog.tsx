// Shows the parcel_history audit log for a parcel.
// Each row: date · old → new area · delta in dka.

import { useEffect, useState } from "react";
import { History, Loader2, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface ParcelHistoryDialogProps {
  parcelId: string;
  parcelName: string;
}

interface HistoryRow {
  id: string;
  changed_at: string;
  old_area_ha: number;
  new_area_ha: number;
}

export function ParcelHistoryDialog({ parcelId, parcelName }: ParcelHistoryDialogProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("parcel_history")
        .select("id, changed_at, old_area_ha, new_area_ha")
        .eq("parcel_id", parcelId)
        .order("changed_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (!error && data) setRows(data as HistoryRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, parcelId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <History className="mr-2 h-4 w-4" />
          История на промените
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>История · {parcelName}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Зареждам…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Няма записани промени за този парцел.
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const oldDka = r.old_area_ha * 10;
              const newDka = r.new_area_ha * 10;
              const delta = newDka - oldDka;
              const deltaStr = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} дка`;
              const deltaColor =
                delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-muted-foreground";
              return (
                <li
                  key={r.id}
                  className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm"
                >
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.changed_at).toLocaleString("bg-BG", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-medium">
                    <span>{oldDka.toFixed(2)} дка</span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{newDka.toFixed(2)} дка</span>
                    <span className={`ml-auto text-xs font-semibold ${deltaColor}`}>
                      {deltaStr}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
