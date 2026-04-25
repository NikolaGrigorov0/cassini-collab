import { useState } from "react";
import { CloudRain, Loader2, MapPin, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { getRainForGeometry, type RainInfo } from "@/lib/weather";
import { convertWater } from "@/lib/waterUnits";
import { toast } from "sonner";

interface Props {
  parcelId: string;
  parcelName: string;
  /** GeoJSON Polygon/MultiPolygon (object or stringified). Used to look up rain. */
  geometry?: unknown;
  /** Parcel area in hectares — used to convert mm → liters in messages. */
  areaHectares?: number;
}

type ActionKind = "rain" | null;

export function QuickIrrigationActions({
  parcelId,
  parcelName,
  geometry,
  areaHectares,
}: Props) {
  const [kind, setKind] = useState<ActionKind>(null);
  const [amount, setAmount] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Rain auto-lookup state
  const [rainLoading, setRainLoading] = useState(false);
  const [rainInfo, setRainInfo] = useState<RainInfo | null>(null);
  const [rainError, setRainError] = useState<string | null>(null);

  const lookupRain = async () => {
    if (!geometry) {
      setRainError("Няма геометрия за този парцел.");
      return;
    }
    setRainLoading(true);
    setRainError(null);
    try {
      const info = await getRainForGeometry(geometry);
      if (!info) throw new Error("Невалидна геометрия");
      setRainInfo(info);
      // Pre-fill the input with rain amount converted to m³ for the whole parcel.
      if (areaHectares && areaHectares > 0) {
        const m3 = convertWater(info.mm, areaHectares).totalM3;
        setAmount(m3.toFixed(1));
      } else {
        setAmount(String(info.mm));
      }
    } catch (e) {
      setRainError(e instanceof Error ? e.message : "Грешка при извличане на валежи");
    } finally {
      setRainLoading(false);
    }
  };

  const openRain = () => {
    setKind("rain");
    setRainInfo(null);
    setRainError(null);
    setAmount("");
    void lookupRain();
  };

  const close = () => {
    if (saving) return;
    setKind(null);
    setAmount("");
    setRainInfo(null);
    setRainError(null);
  };

  const saveRain = async () => {
    const m3 = Number(amount);
    if (!Number.isFinite(m3) || m3 < 0) {
      toast.error("Въведи валидно количество в м³");
      return;
    }
    // Convert m³ (total for parcel) → mm (depth) for DB storage.
    // 1 mm on 1 dka = 1 m³, so mm = m3_total / area_dka.
    const areaDka = areaHectares && areaHectares > 0 ? areaHectares * 10 : 1;
    const mm = m3 / areaDka;
    setSaving(true);
    try {
      const { error } = await supabase.from("irrigation_events").insert({
        parcel_id: parcelId,
        amount_mm: mm,
        method: "rain",
        notes: rainInfo
          ? `Авто от Open-Meteo: ${rainInfo.place} (${rainInfo.lat.toFixed(3)}, ${rainInfo.lon.toFixed(3)})`
          : null,
      });
      if (error) throw error;

      const placeSuffix = rainInfo ? ` (${rainInfo.place})` : "";
      await createNotification({
        title: `🌧️ Регистриран валеж`,
        body: `${parcelName}${placeSuffix}: ${m3.toFixed(1)} м³. Препоръката ще се преизчисли.`,
        kind: "irrigation",
        parcel_id: parcelId,
      });

      toast.success("Валежът е записан");
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Грешка при запис");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <Button
          variant="outline"
          className="w-full border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950"
          onClick={openRain}
        >
          <CloudRain className="mr-2 h-4 w-4" />
          🌧️ Вали днес
        </Button>
        <p className="px-1 text-[10px] leading-tight text-muted-foreground">
          Авто от метео за района
        </p>
      </div>

      <Dialog open={kind !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Регистрирай валеж</DialogTitle>
            <DialogDescription>
              {parcelName} — извличаме автоматично количеството валеж за района на парцела от метео данните за днес.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            {rainLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Извличам валежи за района…
              </div>
            ) : rainError ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-destructive">{rainError}</span>
                <Button size="sm" variant="ghost" onClick={lookupRain}>
                  <RefreshCw className="mr-1 h-3 w-3" /> Опитай пак
                </Button>
              </div>
            ) : rainInfo ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  <span>{rainInfo.place}</span>
                </div>
                <div>
                  Днес в района:{" "}
                  <span className="font-semibold">
                    {rainInfo.mm > 0
                      ? areaHectares && areaHectares > 0
                        ? `${convertWater(rainInfo.mm, areaHectares).totalM3.toFixed(1)} м³ валеж`
                        : `${rainInfo.mm} mm валеж`
                      : "няма валеж"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={lookupRain}
                  className="text-xs text-primary hover:underline"
                >
                  Обнови
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2 py-2">
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1"
            />
            <span className="font-mono text-sm text-muted-foreground">м³</span>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Можеш да коригираш стойността ръчно, ако твоят дъждомер показва различно. Стойността е общо за целия парцел.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>
              Отказ
            </Button>
            <Button onClick={saveRain} disabled={saving || rainLoading}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Запиши
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
