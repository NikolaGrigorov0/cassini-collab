import type { StyleSpecification } from "maplibre-gl";

/**
 * Free satellite basemap using ESRI World Imagery + a light Carto labels overlay.
 * No API key required. Suited for agricultural parcel viewing because farmers
 * can recognise their fields against actual ground texture.
 */
export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    "esri-imagery": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        'Imagery © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
    },
    "carto-labels": {
      type: "raster",
      tiles: [
        "https://basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 20,
      attribution: "Labels © <a href=\"https://carto.com/\">CARTO</a>",
    },
  },
  layers: [
    { id: "imagery", type: "raster", source: "esri-imagery" },
    { id: "labels", type: "raster", source: "carto-labels", paint: { "raster-opacity": 0.9 } },
  ],
};
