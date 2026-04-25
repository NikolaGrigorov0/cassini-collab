// Parse KML, KMZ and Shapefile (zipped) into a single GeoJSON Polygon.
//
// Heavy parser libs are imported dynamically so they only load when the user
// actually uses the import feature.

export type ImportedPolygon = {
  geometry: GeoJSON.Polygon;
  name?: string;
  areaHectares: number;
};

const R = 6378137;

function ringAreaHectares(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    area += ((lng2 - lng1) * Math.PI / 180) * (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
  }
  return Math.abs(area * R * R / 2) / 10000;
}

function pickPolygon(fc: GeoJSON.FeatureCollection | GeoJSON.Feature | GeoJSON.Geometry | null | undefined): { polygon: GeoJSON.Polygon | null; name?: string } {
  if (!fc) return { polygon: null };

  if ("type" in fc && fc.type === "FeatureCollection") {
    // Pick the largest polygon-like feature
    let best: { polygon: GeoJSON.Polygon; area: number; name?: string } | null = null;
    for (const f of fc.features) {
      const inner = pickPolygon(f);
      if (inner.polygon) {
        const a = ringAreaHectares(inner.polygon.coordinates[0] as [number, number][]);
        const candName = (f.properties && (f.properties.name || f.properties.NAME)) as string | undefined;
        if (!best || a > best.area) best = { polygon: inner.polygon, area: a, name: inner.name ?? candName };
      }
    }
    return best ? { polygon: best.polygon, name: best.name } : { polygon: null };
  }

  if ("type" in fc && fc.type === "Feature") {
    const inner = pickPolygon(fc.geometry);
    const candName = (fc.properties && (fc.properties.name || fc.properties.NAME)) as string | undefined;
    return { polygon: inner.polygon, name: inner.name ?? candName };
  }

  if ("type" in fc) {
    if (fc.type === "Polygon") {
      return { polygon: fc as GeoJSON.Polygon };
    }
    if (fc.type === "MultiPolygon") {
      // Return largest sub-polygon
      const mp = fc as GeoJSON.MultiPolygon;
      let best: { polygon: GeoJSON.Polygon; area: number } | null = null;
      for (const coords of mp.coordinates) {
        const poly: GeoJSON.Polygon = { type: "Polygon", coordinates: coords };
        const a = ringAreaHectares(coords[0] as [number, number][]);
        if (!best || a > best.area) best = { polygon: poly, area: a };
      }
      return best ? { polygon: best.polygon } : { polygon: null };
    }
  }

  return { polygon: null };
}

async function parseKmlString(kmlText: string): Promise<GeoJSON.FeatureCollection> {
  const togeojson = await import("@tmcw/togeojson");
  const dom = new DOMParser().parseFromString(kmlText, "text/xml");
  return togeojson.kml(dom) as GeoJSON.FeatureCollection;
}

async function parseKmzFile(file: File): Promise<GeoJSON.FeatureCollection> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  let kmlEntry: import("jszip").JSZipObject | undefined;
  zip.forEach((path, entry) => {
    if (!kmlEntry && /\.kml$/i.test(path)) kmlEntry = entry;
  });
  if (!kmlEntry) throw new Error("В KMZ архива няма .kml файл");
  const text = await kmlEntry.async("string");
  return parseKmlString(text);
}

async function parseShpZipFile(file: File): Promise<GeoJSON.FeatureCollection> {
  const shp = (await import("shpjs")).default;
  const buffer = await file.arrayBuffer();
  const result = await shp(buffer);
  if (Array.isArray(result)) {
    // Multiple feature collections — merge
    return {
      type: "FeatureCollection",
      features: result.flatMap((fc) => fc.features),
    };
  }
  return result as GeoJSON.FeatureCollection;
}

/**
 * Detect the file type and parse it into a single best polygon.
 * Throws a user-friendly Error on failure.
 */
export async function parseParcelFile(file: File): Promise<ImportedPolygon> {
  const lower = file.name.toLowerCase();
  let fc: GeoJSON.FeatureCollection;

  if (lower.endsWith(".kml")) {
    const text = await file.text();
    fc = await parseKmlString(text);
  } else if (lower.endsWith(".kmz")) {
    fc = await parseKmzFile(file);
  } else if (lower.endsWith(".zip") || lower.endsWith(".shp")) {
    // .shp alone won't work without .dbf/.prj — instruct user
    if (lower.endsWith(".shp")) {
      throw new Error("За Shapefile импортирай .zip с .shp + .dbf + .prj вътре.");
    }
    fc = await parseShpZipFile(file);
  } else if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    const text = await file.text();
    fc = JSON.parse(text);
  } else {
    throw new Error("Поддържат се само KML, KMZ, Shapefile (.zip) и GeoJSON.");
  }

  const picked = pickPolygon(fc);
  if (!picked.polygon) {
    throw new Error("Във файла няма валиден полигон.");
  }

  // Ensure ring is closed
  const ring = picked.polygon.coordinates[0] as [number, number][];
  if (ring.length >= 3) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push(first);
    }
  }

  // Validate coordinates look like lng/lat
  const valid = ring.every(([x, y]) => x >= -180 && x <= 180 && y >= -90 && y <= 90);
  if (!valid) {
    throw new Error("Координатите не са в WGS84 (lng/lat). Преобразувай файла преди импорт.");
  }

  return {
    geometry: { type: "Polygon", coordinates: [ring] },
    name: picked.name,
    areaHectares: ringAreaHectares(ring),
  };
}
