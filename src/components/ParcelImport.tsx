// File picker + parser UI for importing parcel outlines from KML/KMZ/Shapefile.
import { useRef, useState } from "react";
import { Upload, Loader2, FileText, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { parseParcelFile, type ImportedPolygon } from "@/lib/parcelImport";

interface ParcelImportProps {
  onImported: (result: ImportedPolygon) => void;
}

export function ParcelImport({ onImported }: ParcelImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setLoading(true);
    try {
      const result = await parseParcelFile(file);
      onImported(result);
      toast.success(`Импортирано: ${result.areaHectares.toFixed(2)} ха`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Неуспешен импорт";
      toast.error(msg);
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-3">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="flex-1">
          <div className="text-sm font-semibold">Импортирай очертания</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            KML, KMZ или Shapefile (.zip с .shp + .dbf + .prj).
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={loading}
            >
              {loading ? (
                <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Парсване…</>
              ) : (
                <><Upload className="mr-1.5 h-4 w-4" /> Избери файл</>
              )}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".kml,.kmz,.zip,.geojson,.json"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>Тези формати се използват от ДФЗ — можеш да импортираш директно своите субсидийни очертания.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
