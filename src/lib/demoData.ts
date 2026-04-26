// Demo-only mock parcels — different region (Dobrudzha, NE Bulgaria) and a
// distinctive narrative so the guided demo feels different from the user's
// empty/seeded try-out dashboard.
import type { MockParcel } from "@/lib/mockData";

// Demo-only flag — surfaced in the sidebar chips to showcase the
// "✓ Полято днес" badge that the real dashboard renders after the user
// logs an irrigation event for the day.
export const DEMO_WATERED_TODAY: Record<string, { time: string }> = {
  d4: { time: "07:42" },
};

const mkPoly = (
  cx: number,
  cy: number,
  sx = 0.012,
  sy = 0.008,
): GeoJSON.Polygon => ({
  type: "Polygon",
  coordinates: [[
    [cx - sx, cy - sy],
    [cx + sx * 0.8, cy - sy * 1.1],
    [cx + sx, cy + sy * 0.6],
    [cx - sx * 0.6, cy + sy],
    [cx - sx, cy - sy],
  ]],
});

const days = ["Пон", "Вт", "Ср", "Чет", "Пет", "Съб", "Нед"];

export const DEMO_CENTER: [number, number] = [27.83, 43.84]; // Dobrich area
export const DEMO_ZOOM = 12;

export const DEMO_PARCELS: MockParcel[] = [
  {
    id: "d1",
    name: "Добруджанска нива №7",
    crop_type: "wheat",
    growth_phase: "mid",
    area_hectares: 12.4,
    geometry: mkPoly(27.825, 43.848),
    ndmi: -0.05,
    ndvi: 0.55,
    // Daily dose (mm) — matches what IrrigationCard shows in the today box.
    // Previously this was the 7-day total which made the sidebar number ≈4×
    // bigger than the detail panel's "Полей" figure.
    dose_mm: 5,
    status: "yellow",
    reason:
      "След 12 дни без дъжд NDMI пада. Полей умерено преди фаза наливане на зърното.",
    recorded_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    forecast: days.map((d, i) => ({
      day: d,
      dose: [4, 5, 0, 4, 5, 2, 2][i],
      rain: i === 2,
    })),
  },
  {
    id: "d2",
    name: "Слънчогледово поле Юг",
    crop_type: "sunflower",
    growth_phase: "development",
    area_hectares: 18.7,
    geometry: mkPoly(27.852, 43.832),
    ndmi: 0.21,
    ndvi: 0.68,
    dose_mm: 0,
    status: "green",
    reason:
      "Достатъчна почвена влага. Очаквани 8mm дъжд в петък — пропусни поливане.",
    recorded_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    forecast: days.map((d, i) => ({
      day: d,
      dose: [0, 0, 0, 0, 0, 1, 0][i],
      rain: i === 4,
    })),
  },
  {
    id: "d3",
    name: "Царевица Дунавски бряг",
    crop_type: "corn",
    growth_phase: "mid",
    area_hectares: 8.9,
    geometry: mkPoly(27.808, 43.829),
    ndmi: -0.18,
    ndvi: 0.42,
    dose_mm: 8,
    status: "red",
    reason:
      "Сериозен воден стрес засечен по NDMI. Незабавно поливане преди тасселиране.",
    recorded_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    forecast: days.map((d, i) => ({
      day: d,
      dose: [8, 7, 6, 5, 5, 4, 3][i],
      rain: false,
    })),
  },
  {
    id: "d4",
    name: "Доматена ферма Белица",
    crop_type: "tomatoes",
    growth_phase: "late",
    area_hectares: 2.1,
    geometry: mkPoly(27.838, 43.858),
    ndmi: 0.12,
    ndvi: 0.61,
    dose_mm: 3,
    status: "yellow",
    reason: "Леко напояване преди прибиране за качество на плода.",
    recorded_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    forecast: days.map((d, i) => ({
      day: d,
      dose: [3, 2, 0, 2, 2, 1, 2][i],
      rain: i === 2,
    })),
  },
];
