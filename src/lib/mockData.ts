// Mock data for AquaDose demo (3 parcels around Plovdiv, Bulgaria)
export type IrrigationStatus = "green" | "yellow" | "red";
export type CropType = "wheat" | "corn" | "tomatoes" | "sunflower" | "vineyard";
export type GrowthPhase = "initial" | "development" | "mid" | "late";

export interface MockParcel {
  id: string;
  name: string;
  crop_type: CropType;
  growth_phase: GrowthPhase;
  area_hectares: number;
  geometry: GeoJSON.Polygon;
  ndmi: number;
  ndvi: number;
  dose_mm: number;
  status: IrrigationStatus;
  reason: string;
  recorded_at: string;
  forecast: { day: string; dose: number; rain: boolean }[];
  pump_flow_m3h?: number | null;
  soil_type?: string | null;
  soil_type_wrb?: string | null;
  soil_type_bg?: string | null;
  soil_fc_pct?: number | null;
  soil_wp_pct?: number | null;
  soil_awc_pct?: number | null;
  soil_ph?: number | null;
  soil_organic_carbon?: number | null;
  soil_clay_pct?: number | null;
  soil_sand_pct?: number | null;
  soil_silt_pct?: number | null;
}

const mkPoly = (cx: number, cy: number, sx = 0.008, sy = 0.006): GeoJSON.Polygon => ({
  type: "Polygon",
  coordinates: [[
    [cx - sx, cy - sy],
    [cx + sx, cy - sy],
    [cx + sx, cy + sy],
    [cx - sx, cy + sy],
    [cx - sx, cy - sy],
  ]],
});

const days = ["Пон","Вт","Ср","Чет","Пет","Съб","Нед"];

export const MOCK_PARCELS: MockParcel[] = [
  {
    id: "p1",
    name: "Северна нива",
    crop_type: "wheat",
    growth_phase: "mid",
    area_hectares: 4.2,
    geometry: mkPoly(24.745, 42.158),
    ndmi: 0.08,
    ndvi: 0.62,
    dose_mm: 18,
    status: "yellow",
    reason: "Полей умерено. NDMI показва лек воден стрес.",
    recorded_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    forecast: days.map((d, i) => ({ day: d, dose: [3, 4, 0, 5, 4, 0, 2][i], rain: i === 2 || i === 5 })),
  },
  {
    id: "p2",
    name: "Лозе при реката",
    crop_type: "vineyard",
    growth_phase: "development",
    area_hectares: 2.8,
    geometry: mkPoly(24.762, 42.142),
    ndmi: 0.32,
    ndvi: 0.71,
    dose_mm: 0,
    status: "green",
    reason: "Без напояване. Влагата е достатъчна.",
    recorded_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    forecast: days.map((d, i) => ({ day: d, dose: [0, 0, 1, 0, 0, 2, 0][i], rain: i === 0 || i === 3 })),
  },
  {
    id: "p3",
    name: "Доматена градина",
    crop_type: "tomatoes",
    growth_phase: "mid",
    area_hectares: 1.6,
    geometry: mkPoly(24.738, 42.135),
    ndmi: -0.12,
    ndvi: 0.48,
    dose_mm: 32,
    status: "red",
    reason: "Спешно напояване. Силен воден стрес.",
    recorded_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    forecast: days.map((d, i) => ({ day: d, dose: [6, 6, 4, 5, 5, 3, 3][i], rain: i === 2 })),
  },
];

export const CROP_LABELS: Record<CropType, string> = {
  wheat: "Пшеница",
  corn: "Царевица",
  tomatoes: "Домати",
  sunflower: "Слънчоглед",
  vineyard: "Лозе",
};

export const CROP_ICONS: Record<CropType, string> = {
  wheat: "🌾",
  corn: "🌽",
  tomatoes: "🍅",
  sunflower: "🌻",
  vineyard: "🍇",
};

export const PHASE_LABELS: Record<GrowthPhase, string> = {
  initial: "Начална",
  development: "Развитие",
  mid: "Средна",
  late: "Финална",
};

export const STATUS_COLORS: Record<IrrigationStatus, { fill: string; text: string; bg: string; label: string }> = {
  green: { fill: "#16a34a", text: "text-status-green", bg: "bg-status-green", label: "Без напояване" },
  yellow: { fill: "#eab308", text: "text-status-yellow", bg: "bg-status-yellow", label: "Умерено напояване" },
  red: { fill: "#dc2626", text: "text-status-red", bg: "bg-status-red", label: "Спешно напояване" },
};
