// Water unit conversions and irrigation runtime helpers.
//
// In Bulgaria, farmers think in декари (dka) and кубици (m³), not mm.
//   1 hectare = 10 декара
//   1 mm of water on 1 декар (1000 m²) = 1000 liters = 1 m³
//   So: mm × area_dka = m³  (and  mm × area_dka × 1000 = liters)

export interface WaterUnits {
  mm: number;            // dose in millimetres
  litersPerDka: number;  // liters per декар
  m3PerDka: number;      // m³ per декар
  totalLiters: number;   // total liters for the whole parcel
  totalM3: number;       // total m³ for the whole parcel
}

/**
 * Convert a mm dose into liters/m³ for a parcel.
 * @param mm dose in millimetres of water
 * @param areaHectares parcel area in hectares
 */
export function convertWater(mm: number, areaHectares: number): WaterUnits {
  const dka = areaHectares * 10;
  const litersPerDka = mm * 1000;       // 1 mm × 1000 m² = 1000 L
  const m3PerDka = mm;                  // 1 mm on 1 dka = 1 m³
  const totalLiters = litersPerDka * dka;
  const totalM3 = m3PerDka * dka;
  return {
    mm,
    litersPerDka,
    m3PerDka,
    totalLiters,
    totalM3,
  };
}

/** Estimate pump runtime (in hours) for a given m³ at a flow rate. */
export function pumpRuntimeHours(totalM3: number, flowM3PerHour: number | null | undefined): number | null {
  if (!flowM3PerHour || flowM3PerHour <= 0) return null;
  return totalM3 / flowM3PerHour;
}

/** Format hours as "Xч Yмин" (Bulgarian short). */
export function formatHours(hours: number): string {
  if (!isFinite(hours) || hours < 0) return "-";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

/** Compact label like "500 л/дка (0.5 м³ · 5 мм)". */
export function formatPerDka(units: WaterUnits): string {
  return `${Math.round(units.litersPerDka).toLocaleString("bg-BG")} л/дка  ·  ${units.m3PerDka.toFixed(2)} м³/дка  ·  ${units.mm} мм`;
}

/** Compact label for the whole parcel: "12 000 л (12.0 м³ · 5 мм)". */
export function formatTotal(units: WaterUnits): string {
  const liters = Math.round(units.totalLiters).toLocaleString("bg-BG");
  return `${liters} л  ·  ${units.totalM3.toFixed(1)} м³  ·  ${units.mm} мм`;
}
