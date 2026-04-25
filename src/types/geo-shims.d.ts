declare module "shpjs" {
  type FC = GeoJSON.FeatureCollection;
  function shp(input: ArrayBuffer | string | Uint8Array): Promise<FC | FC[]>;
  export default shp;
}

declare module "@tmcw/togeojson" {
  export function kml(doc: Document | XMLDocument): GeoJSON.FeatureCollection;
  export function gpx(doc: Document | XMLDocument): GeoJSON.FeatureCollection;
}
