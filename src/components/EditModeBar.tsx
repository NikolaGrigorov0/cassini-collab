// Floating action bar shown at the bottom of the map while editing a parcel's
// shape. The side panel is hidden in edit mode so the map gets full screen
// for vertex dragging — this bar provides Save/Cancel + live area readout.

import { Save, Ban, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  parcelName: string;
  originalAreaHa: number;
  liveAreaHa: number | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export function EditModeBar({ parcelName, originalAreaHa, liveAreaHa, saving, onSave, onCancel }: Props) {
  const ha = liveAreaHa ?? originalAreaHa;
  const dka = ha * 10;
  const dDka = (ha - originalAreaHa) * 10;
  const sign = dDka >= 0 ? "+" : "";
  const dCls = dDka > 0.01 ? "text-emerald-200" : dDka < -0.01 ? "text-red-200" : "text-amber-100/80";

  return (
    <>
      {/* Top edit-mode badge with parcel name */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-amber-400 bg-amber-500/95 px-4 py-1.5 text-xs font-semibold text-white shadow-elevated backdrop-blur">
        <Pencil className="mr-1.5 inline h-3.5 w-3.5" />
        Редактиране на: {parcelName}
      </div>

      {/* Bottom floating action bar */}
      <div
        className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 border-t-2 border-amber-400/80 bg-slate-900/92 p-3 shadow-elevated backdrop-blur sm:inset-x-3 sm:bottom-3 sm:rounded-2xl sm:border"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-white">
            <span className="text-lg">📐</span>
            <span>
              Площ: <b className="text-amber-200">{ha.toFixed(2)} ха</b>
              <span className="ml-1.5 text-xs opacity-90">
                ({dka.toFixed(1)} дка
                {Math.abs(dDka) > 0.01 && (
                  <span className={`ml-1 font-semibold ${dCls}`}>
                    {sign}{dDka.toFixed(2)} дка
                  </span>
                )}
                )
              </span>
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={onCancel}
              disabled={saving}
              variant="outline"
              className="min-h-[56px] flex-1 border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white sm:min-h-0 sm:flex-none"
            >
              <Ban className="mr-2 h-4 w-4" />
              Откажи
            </Button>
            <Button
              onClick={onSave}
              disabled={saving}
              className="min-h-[56px] flex-1 bg-emerald-500 text-white hover:bg-emerald-600 sm:min-h-0 sm:flex-none"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Запази промените
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
