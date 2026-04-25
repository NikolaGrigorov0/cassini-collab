// Debounced Nominatim search restricted to Bulgaria.
// Returns formatted place results suitable for a map place picker.

import { useEffect, useRef, useState } from "react";

export interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  suburb?: string;
  municipality?: string;
  county?: string;
  state?: string;
  country?: string;
}

export interface NominatimRaw {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  class?: string;
  address?: NominatimAddress;
}

export interface PlaceResult {
  id: number;
  lat: number;
  lon: number;
  primary: string;
  secondary: string;
  raw: NominatimRaw;
}

const ALLOWED_TYPES = new Set([
  "city",
  "town",
  "village",
  "suburb",
  "hamlet",
  "municipality",
  "administrative",
]);

function formatResult(r: NominatimRaw): PlaceResult | null {
  const a = r.address ?? {};
  const primary =
    a.city || a.town || a.village || a.suburb || a.municipality || r.display_name.split(",")[0];
  if (!primary) return null;
  const secondary = a.county || a.state || "България";
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    id: r.place_id,
    lat,
    lon,
    primary,
    secondary,
    raw: r,
  };
}

export function useLocationSearch(query: string) {
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();

    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    timerRef.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const url =
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}` +
          `&format=json&limit=8&countrycodes=bg&addressdetails=1&accept-language=bg`;
        const r = await fetch(url, {
          signal: ctrl.signal,
          headers: {
            "Accept-Language": "bg",
            // Note: browsers ignore custom User-Agent; included for spec parity.
            "X-Client": "AquaDose-Hackathon/1.0",
          },
        });
        if (!r.ok) throw new Error("nominatim failed");
        const j: NominatimRaw[] = await r.json();
        const filtered = j.filter((it) => ALLOWED_TYPES.has(it.type) || ALLOWED_TYPES.has(it.class ?? ""));
        const list = (filtered.length > 0 ? filtered : j)
          .map(formatResult)
          .filter((x): x is PlaceResult => x !== null)
          .slice(0, 5);
        setResults(list);
        setError(null);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setResults([]);
        setError("Търсачката временно недостъпна. Намери местото ръчно на картата.");
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  return { results, loading, error };
}