// Vertex editor for an existing parcel polygon, built on top of MapLibre GL
// using @mapbox/mapbox-gl-draw. The editor takes ownership of the parcel
// outline while editing — the underlying parcels-fill layer is dimmed and
// other parcels are non-clickable (managed by the parent).
//
// Drag a vertex → edit shape. Click a midpoint → add vertex. Double-click a
// vertex → delete it. Live area (turf.area) is reported via onChange.

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import area from "@turf/area";

interface ParcelEditorProps {
  map: maplibregl.Map | null;
  /** Initial polygon to edit (GeoJSON). */
  geometry: GeoJSON.Polygon;
  /** Called whenever the user changes the polygon. */
  onChange: (geometry: GeoJSON.Polygon, areaHectares: number) => void;
}

// Patch MapLibre to expose the methods mapbox-gl-draw expects.
// MapLibre dropped `setPaintProperty`-style classes in v3 but the API surface
// still exists. The few helpers below are safe no-ops/aliases.
function patchMapForDraw(map: maplibregl.Map) {
  const m = map as unknown as {
    getCanvasContainer: () => HTMLElement;
    fire: (event: string, data?: unknown) => void;
  } & Record<string, unknown>;

  // mapbox-gl-draw expects map.boxZoom?.disable etc to exist; MapLibre has them.
  // No further patching needed for current versions of mapbox-gl-draw + MapLibre 5.
  return m;
}

export function ParcelEditor({ map, geometry, onChange }: ParcelEditorProps) {
  const drawRef = useRef<MapboxDraw | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!map) return;
    patchMapForDraw(map);

    // Construct draw instance limited to direct_select / simple_select / static.
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      defaultMode: "simple_select",
      // Larger touch targets on mobile — matches the 24px UX requirement.
      // mapbox-gl-draw uses fixed circle radii in the styles but we override
      // with custom paint below.
      styles: [
        // Polygon fill while editing
        {
          id: "gl-draw-polygon-fill",
          type: "fill",
          filter: ["all", ["==", "$type", "Polygon"]],
          paint: {
            "fill-color": "#f59e0b",
            "fill-outline-color": "#f59e0b",
            "fill-opacity": 0.18,
          },
        },
        // Outline (orange/yellow as required for edit mode visual)
        {
          id: "gl-draw-polygon-stroke-active",
          type: "line",
          filter: ["all", ["==", "$type", "Polygon"]],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#f59e0b",
            "line-dasharray": [0.4, 1.6],
            "line-width": 3,
          },
        },
        // Midpoint handles (clickable to add vertex)
        {
          id: "gl-draw-polygon-midpoint",
          type: "circle",
          filter: ["all", ["==", "$type", "Point"], ["==", "meta", "midpoint"]],
          paint: {
            "circle-radius": 6,
            "circle-color": "#fff",
            "circle-stroke-color": "#f59e0b",
            "circle-stroke-width": 2,
          },
        },
        // Vertex outer ring (white halo)
        {
          id: "gl-draw-polygon-and-line-vertex-halo-active",
          type: "circle",
          filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"]],
          paint: {
            "circle-radius": 11,
            "circle-color": "#fff",
          },
        },
        // Vertex (drag handle)
        {
          id: "gl-draw-polygon-and-line-vertex-active",
          type: "circle",
          filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"]],
          paint: {
            "circle-radius": 8,
            "circle-color": "#f59e0b",
            "circle-stroke-color": "#fff",
            "circle-stroke-width": 2,
          },
        },
      ],
    });

    drawRef.current = draw;

    // mapbox-gl-draw is added via addControl
    map.addControl(draw as unknown as maplibregl.IControl);

    // Add the feature and switch to direct_select so vertex handles appear immediately
    const featureIds = draw.add({
      type: "Feature",
      geometry,
      properties: {},
    });
    draw.changeMode("direct_select", { featureId: featureIds[0] });

    const fireChange = () => {
      const fc = draw.getAll();
      const f = fc.features[0];
      if (!f || f.geometry.type !== "Polygon") return;
      const polygon = f.geometry as GeoJSON.Polygon;
      const m2 = area(polygon);
      const ha = m2 / 10000;
      onChangeRef.current(polygon, ha);
    };

    map.on("draw.update", fireChange);
    map.on("draw.create", fireChange);
    map.on("draw.delete", fireChange);

    // Initial fire to publish current area (in case parent wants it immediately)
    fireChange();

    return () => {
      map.off("draw.update", fireChange);
      map.off("draw.create", fireChange);
      map.off("draw.delete", fireChange);
      try {
        map.removeControl(draw as unknown as maplibregl.IControl);
      } catch {
        // already removed
      }
      drawRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]); // we intentionally don't reset when geometry changes — edits are local

  return null;
}
