// Edit parcel basic info: name, crop, growth phase, area.
// On save: writes to parcels, then triggers a recalculation hook (recalc-parcel)
// so a fresh recommendation is produced with the new Kc / area.
// To redraw the polygon the user is sent into the existing in-place edit flow
// — that flow already handles geometry + soil re-enrichment.

import { useEffect, useState } from "react";
import { Loader2, Pencil, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CROP_ICONS,
  CROP_LABELS,
  PHASE_LABELS,
  type CropType,
  type GrowthPhase,
  type MockParcel,
} from "@/lib/mockData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  parcel: MockParcel | null;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save with the updated values. */
  onSaved: (next: Partial<MockParcel>) => void;
  /** Switch the dashboard into the in-place polygon edit flow. */
  onRedrawBoundary: () => void;
}

const CROPS: CropType[] = ["wheat", "corn", "tomatoes", "sunflower", "vineyard"];
const PHASES: GrowthPhase[] = ["initial", "development", "mid", "late"];

export function EditParcelModal({ open, parcel, onOpenChange, onSaved, onRedrawBoundary }: Props) {
  const [name, setName] = useState("");
  const [crop, setCrop] = useState<CropType>("wheat");
  const [phase, setPhase] = useState<GrowthPhase>("mid");
  const [areaHa, setAreaHa] = useState<number>(0);
  const [sowingDate, setSowingDate] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!parcel) return;
    setName(parcel.name);
    setCrop(parcel.crop_type);
    setPhase(parcel.growth_phase);
    setAreaHa(parcel.area_hectares);
    setSowingDate(parcel.sowing_date ?? "");
  }, [parcel]);

  if (!parcel) return null;

  const cropChanged = crop !== parcel.crop_type;
  const phaseChanged = phase !== parcel.growth_phase;
  const areaChanged = Math.abs(areaHa - parcel.area_hectares) > 0.001;
  const sowingChanged = (sowingDate || null) !== (parcel.sowing_date ?? null);
  const recalcNeeded = cropChanged || phaseChanged || areaChanged || sowingChanged;

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Името е задължително");
      return;
    }
    if (!Number.isFinite(areaHa) || areaHa <= 0) {
      toast.error("Площта трябва да е положителна");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("parcels")
        .update({
          name: name.trim(),
          crop_type: crop,
          growth_phase: phase,
          area_hectares: areaHa,
          sowing_date: sowingDate || null,
        })
        .eq("id", parcel.id);
      if (error) throw error;

      // Trigger a fresh recommendation. Best-effort: don't block on errors.
      if (recalcNeeded) {
        void fetch("/api/public/hooks/recalc-parcel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parcel_id: parcel.id,
            reason: cropChanged
              ? `Култура променена на ${CROP_LABELS[crop]}`
              : phaseChanged
                ? `Фаза променена на ${PHASE_LABELS[phase]}`
                : "Площта е обновена",
          }),
        }).catch((e) => console.warn("recalc-parcel failed:", e));
      }

      onSaved({
        name: name.trim(),
        crop_type: crop,
        growth_phase: phase,
        area_hectares: areaHa,
        sowing_date: sowingDate || null,
      });
      toast.success("Парцелът е обновен и данните се преизчисляват");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Грешка при запис");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Редактирай парцел
          </DialogTitle>
          <DialogDescription>
            Промени основните данни. След запис препоръката се преизчислява автоматично.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Section 1 — Basic info */}
          <div className="space-y-2">
            <Label htmlFor="parcel-name">Име на парцел</Label>
            <Input
              id="parcel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </div>

          <div className="space-y-2">
            <Label>Култура</Label>
            <div className="grid grid-cols-5 gap-2">
              {CROPS.map((c) => {
                const active = c === crop;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCrop(c)}
                    className={`flex flex-col items-center gap-1 rounded-xl border-2 p-2 text-xs transition ${
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    <span className="text-xl">{CROP_ICONS[c]}</span>
                    <span className="font-medium">{CROP_LABELS[c]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Фенофаза</Label>
            <Select value={phase} onValueChange={(v) => setPhase(v as GrowthPhase)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PHASES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PHASE_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="parcel-area">Площ (хектари)</Label>
            <Input
              id="parcel-area"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              value={areaHa}
              onChange={(e) => setAreaHa(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              {(areaHa * 10).toFixed(2)} декара
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="parcel-sowing">📅 Дата на засяване</Label>
            <Input
              id="parcel-sowing"
              type="date"
              value={sowingDate}
              onChange={(e) => setSowingDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
            />
            <p className="text-xs text-muted-foreground">
              Текущата фенофаза се изчислява автоматично от датата на засяване.
            </p>
          </div>

          {/* Section 2 — Polygon redraw */}
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <MapIcon className="h-4 w-4 text-primary" />
                  Промени границите на парцела
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ще влезеш в режим на редакция на полигона върху картата.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  onRedrawBoundary();
                }}
              >
                Редактирай форма
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отказ
          </Button>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={handleSave}
            disabled={saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Запази промените
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}