// Search bar overlay for the Add Parcel map. Looks up Bulgarian places via
// Nominatim and exposes a callback when a result is selected.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Search, MapPin } from "lucide-react";
import { useLocationSearch, type PlaceResult } from "@/hooks/useLocationSearch";

interface Props {
  onSelect: (place: PlaceResult) => void;
}

export function LocationSearchBar({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const { results, loading, error } = useLocationSearch(query);

  // Reset highlight whenever results change
  useEffect(() => {
    setHighlight(0);
    if (query.trim().length >= 2) setOpen(true);
  }, [results, query]);

  // Close on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (r: PlaceResult) => {
    setOpen(false);
    setQuery("");
    onSelect(r);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length > 0) setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length > 0) setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[highlight];
      if (r) pick(r);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const showDropdown =
    open && query.trim().length >= 2 && (loading || results.length > 0 || error || true);

  return (
    <div
      ref={containerRef}
      className="absolute left-4 top-4 z-10 w-[300px] max-w-[calc(100vw-2rem)]"
    >
      <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-lg">
        <Search className="h-4 w-4 shrink-0 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim().length >= 2 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Търси град или село в България..."
          className="w-full border-0 bg-transparent p-0 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:outline-none focus:ring-0"
        />
      </div>

      {showDropdown && (
        <div className="mt-1 overflow-hidden rounded-xl bg-white shadow-lg">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-gray-500">
              <div className="h-3 w-3 animate-pulse rounded-full bg-gray-300" />
              Търсене...
            </div>
          )}

          {!loading && error && (
            <div className="px-3 py-2.5 text-sm text-gray-600">{error}</div>
          )}

          {!loading && !error && results.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-gray-500">
              Няма резултати за „{query}“
            </div>
          )}

          {!loading && !error && results.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {results.map((r, i) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(r)}
                    className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition ${
                      i === highlight ? "bg-green-50" : "bg-white hover:bg-green-50"
                    }`}
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-gray-900">{r.primary}</div>
                      <div className="truncate text-xs text-gray-500">{r.secondary}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}