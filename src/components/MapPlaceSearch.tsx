// Map navigation place search. Uses Nominatim (Bulgaria-only) to find a place,
// then calls onSelect with lat/lon to fly the map there.

import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2, MapPin } from "lucide-react";

interface Props {
  onSelect: (lat: number, lon: number, label: string) => void;
}

interface NomResult {
  display_name: string;
  lat: string;
  lon: string;
  place_id: number;
}

export function MapPlaceSearch({ onSelect }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<NomResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const url =
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}` +
          `&format=json&limit=5&countrycodes=bg&addressdetails=0`;
        const r = await fetch(url, { headers: { "Accept-Language": "bg" } });
        if (!r.ok) throw new Error("nominatim failed");
        const j: NomResult[] = await r.json();
        setResults(j);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  // Close on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (r: NomResult) => {
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    setOpen(false);
    setQ(r.display_name.split(",")[0]);
    onSelect(lat, lon, r.display_name);
  };

  return (
    <div ref={containerRef} className="relative w-64 max-w-[80vw]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Търси населено място…"
          className="h-9 w-full rounded-xl border border-border bg-card/95 pl-8 pr-8 text-sm shadow-elevated outline-none backdrop-blur placeholder:text-muted-foreground focus:border-primary"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {!loading && q && (
          <button
            onClick={() => { setQ(""); setResults([]); setOpen(false); }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-muted"
            aria-label="Изчисти"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-card shadow-elevated">
          {results.map((r) => (
            <li key={r.place_id}>
              <button
                onClick={() => pick(r)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">{r.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
