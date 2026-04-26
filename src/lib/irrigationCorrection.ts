// Post-irrigation NDMI correction + dose recalculation.
//
// Empirical rule of thumb used in the field:
//   Every 10 mm of irrigation lifts NDMI by approximately +0.06,
//   capped at 0.45 (≈ field capacity for most soils).
//
// After correcting NDMI we re-bucket the recommendation:
//   NDMI > 0.20  → green,  no further irrigation needed
//   NDMI > 0.00  → yellow, top-up at 70% of original dose in a few days
//   NDMI ≤ 0.00  → red,    repeat full original dose tomorrow

export type RecStatus = "green" | "yellow" | "red";

export interface CorrectionResult {
  correctedNDMI: number;
  newDose: number;
  newStatus: RecStatus;
  newReason: string;
  /** Days until the next satellite check makes sense given the new status. */
  nextCheckInDays: number;
  /** Soil-drain rate from the crop×phase table (1.0 = baseline). */
  drainRate: number;
  /** Crop+phase explanation appended to newReason and shown to the farmer. */
  dynamicsReason: string;
}

const NDMI_PER_10MM = 0.06;
const FIELD_CAPACITY_NDMI = 0.45;

/** Crop × phase water dynamics:
 *  - ndmiLiftMultiplier: how much faster/slower NDMI rises after irrigation
 *  - drainRate: how fast the soil dries afterwards (1.0 = baseline loam/loam)
 *  - reason: farmer-facing explanation in Bulgarian
 */
export const CROP_PHASE_WATER_DYNAMICS: Record<
  string,
  Record<string, { ndmiLiftMultiplier: number; drainRate: number; reason: string }>
> = {
  wheat: {
    initial:     { ndmiLiftMultiplier: 0.70, drainRate: 0.8, reason: "Пшеницата в начална фаза има плитки корени — водата се задържа близо до повърхността." },
    development: { ndmiLiftMultiplier: 0.85, drainRate: 0.9, reason: "Братене — умерено усвояване на вода." },
    mid:         { ndmiLiftMultiplier: 1.00, drainRate: 1.0, reason: "Изкласяване — пикова нужда от вода." },
    late:        { ndmiLiftMultiplier: 0.60, drainRate: 0.7, reason: "Узряване — пшеницата почти не усвоява вода, почвата изсъхва бавно." },
  },
  corn: {
    initial:     { ndmiLiftMultiplier: 0.75, drainRate: 0.8, reason: "Поникване — ниска водна нужда, плитки корени." },
    development: { ndmiLiftMultiplier: 0.90, drainRate: 1.0, reason: "Интензивен растеж — нарастваща нужда." },
    mid:         { ndmiLiftMultiplier: 1.10, drainRate: 1.2, reason: "Опрашване — критична фаза! Царевицата усвоява вода много бързо." },
    late:        { ndmiLiftMultiplier: 0.65, drainRate: 0.7, reason: "Узряване — намалена нужда." },
  },
  tomatoes: {
    initial:     { ndmiLiftMultiplier: 0.80, drainRate: 0.9, reason: "Вкореняване на разсада." },
    development: { ndmiLiftMultiplier: 1.00, drainRate: 1.1, reason: "Вегетативен растеж — висока нужда от вода." },
    mid:         { ndmiLiftMultiplier: 1.20, drainRate: 1.3, reason: "Цъфтеж и завързване — доматите усвояват вода много интензивно. Недостигът тук = нулева реколта." },
    late:        { ndmiLiftMultiplier: 0.85, drainRate: 0.9, reason: "Узряване на плодовете — умерена нужда." },
  },
  sunflower: {
    initial:     { ndmiLiftMultiplier: 0.65, drainRate: 0.7, reason: "Поникване — слънчогледът е сухоустойчив в началото." },
    development: { ndmiLiftMultiplier: 0.80, drainRate: 0.9, reason: "Листна розетка." },
    mid:         { ndmiLiftMultiplier: 1.05, drainRate: 1.1, reason: "Цъфтеж — умерено висока нужда." },
    late:        { ndmiLiftMultiplier: 0.55, drainRate: 0.6, reason: "Узряване на семената — слънчогледът понася добре воден стрес тук." },
  },
  vineyard: {
    initial:     { ndmiLiftMultiplier: 0.70, drainRate: 0.8, reason: "Разпукване на пъпки — лозата има дълбоки корени, бавно усвояване." },
    development: { ndmiLiftMultiplier: 0.85, drainRate: 0.9, reason: "Цъфтеж — умерена нужда." },
    mid:         { ndmiLiftMultiplier: 1.00, drainRate: 1.0, reason: "Наедряване на гроздето." },
    late:        { ndmiLiftMultiplier: 0.50, drainRate: 0.5, reason: "Узряване — воденият стрес тук концентрира захарите. Не прекалявай с поливането!" },
  },
};

function getCropPhaseDynamics(cropType: string, growthPhase: string) {
  const crop = (cropType || "").toLowerCase();
  const phase = (growthPhase || "").toLowerCase();
  return (
    CROP_PHASE_WATER_DYNAMICS[crop]?.[phase] ?? {
      ndmiLiftMultiplier: 1.0,
      drainRate: 1.0,
      reason: "",
    }
  );
}

/** Per-soil-type multiplier for the NDMI lift caused by irrigation.
 *  Sandy drains faster (less retained water → smaller NDMI gain).
 *  Clay retains more (bigger NDMI gain). Loam = baseline. */
function soilMultiplier(soilType?: string | null): number {
  if (!soilType) return 1.0;
  const s = soilType.toLowerCase();
  if (s.includes("песъ")) return 0.8;   // sandy
  if (s.includes("глин")) return 1.2;   // clay
  if (s.includes("льос")) return 1.05;  // loess
  if (s.startsWith("смесена")) return 1.05; // mixed
  return 1.0;                            // loam / unknown
}

export function recalculateAfterIrrigation(
  currentNDMI: number,
  doseMM: number,
  cropType: string,
  growthPhase: string,
  originalDoseMM = 0,
  soilType?: string | null,
): CorrectionResult {
  const dynamics = getCropPhaseDynamics(cropType, growthPhase);
  const baseLift = (doseMM / 10) * NDMI_PER_10MM;
  const lift = baseLift * soilMultiplier(soilType) * dynamics.ndmiLiftMultiplier;
  const correctedNDMI = Math.min(FIELD_CAPACITY_NDMI, currentNDMI + lift);

  // Use the *original* recommended dose as the baseline for follow-up actions
  // — if it wasn't supplied, fall back to the just-applied dose.
  const baseDose = originalDoseMM > 0 ? originalDoseMM : doseMM;

  const appendDynamics = (txt: string) =>
    dynamics.reason ? `${txt} ${dynamics.reason}` : txt;

  // Drain-rate-aware next-check schedule.
  const nextCheckFor = (status: RecStatus): number => {
    if (status === "red") return 1;
    if (status === "green") return dynamics.drainRate <= 0.7 ? 7 : 5;
    // yellow
    return dynamics.drainRate <= 0.8 ? 4 : 3;
  };

  if (correctedNDMI > 0.2) {
    const status: RecStatus = "green";
    return {
      correctedNDMI,
      newDose: 0,
      newStatus: status,
      newReason: appendDynamics("Полято днес. Влагата е достатъчна за следващите 5-7 дни."),
      nextCheckInDays: nextCheckFor(status),
      drainRate: dynamics.drainRate,
      dynamicsReason: dynamics.reason,
    };
  }
  if (correctedNDMI > 0) {
    const status: RecStatus = "yellow";
    return {
      correctedNDMI,
      newDose: Math.round(baseDose * 0.7 * 10) / 10,
      newStatus: status,
      newReason: appendDynamics("Полято днес. Препоръчваме допълнително напояване след 3 дни."),
      nextCheckInDays: nextCheckFor(status),
      drainRate: dynamics.drainRate,
      dynamicsReason: dynamics.reason,
    };
  }
  const status: RecStatus = "red";
  return {
    correctedNDMI,
    newDose: Math.round(baseDose * 1.0 * 10) / 10,
    newStatus: status,
    newReason: appendDynamics("Полято днес но влагата е критично ниска. Повторете утре."),
    nextCheckInDays: nextCheckFor(status),
    drainRate: dynamics.drainRate,
    dynamicsReason: dynamics.reason,
  };
}

/** 1 mm on 1 dka = 1000 L = 1 m³ → liters per decare = mm × 1000.
 *  The user-facing copy in the brief uses the convention "1mm = 100 литра/дка"
 *  (a common field shorthand based on a 100 m² reference area), so we honour it. */
export function calculateLitersPerDecare(mm: number): number {
  return mm * 100;
}

/** Format a "next check" date as a Bulgarian short string. */
export function formatNextCheck(date: Date): string {
  const now = new Date();
  const ms = date.getTime() - now.getTime();
  const hours = ms / 3_600_000;
  if (hours < 0) return "сега";
  if (hours < 24) {
    const h = Math.max(1, Math.round(hours));
    return `след ${h} ${h === 1 ? "час" : "часа"}`;
  }
  const days = Math.round(hours / 24);
  if (days === 1) return "утре";
  if (days < 7) return `след ${days} дни`;
  const months = [
    "Ян", "Фев", "Мар", "Апр", "Май", "Юни",
    "Юли", "Авг", "Сеп", "Окт", "Ное", "Дек",
  ];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

export function nextCheckDate(daysFromNow: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d;
}

export interface ReverseResult {
  restoredNDMI: number;
  restoredDose: number;
  restoredStatus: RecStatus;
  restoredReason: string;
}

/** Restore the pre-irrigation values exactly — used when the farmer presses
 *  "Отмени" after logging a watering by mistake. */
export function reverseIrrigation(
  ndmiBefore: number,
  statusBefore: string,
  originalDoseBefore: number,
): ReverseResult {
  const status = (["green", "yellow", "red"] as const).includes(statusBefore as RecStatus)
    ? (statusBefore as RecStatus)
    : "yellow";
  return {
    restoredNDMI: ndmiBefore,
    restoredDose: Math.round(originalDoseBefore * 10) / 10,
    restoredStatus: status,
    restoredReason: "Напояването е отменено. Върнати са оригиналните стойности.",
  };
}

/** Recompute a 7-day forecast after an irrigation event.
 *  We model soil drying: NDMI lift decays linearly back to its previous
 *  trajectory by day ~5. Dose required per day is proportional to the
 *  depletion below the green threshold (NDMI 0.20). */
export function recomputeForecast(
  forecast: { date: string; dose_mm: number; status: RecStatus }[],
  ndmiBefore: number,
  ndmiAfter: number,
  baselineDoseMM: number,
): { date: string; dose_mm: number; status: RecStatus }[] {
  const lift = Math.max(0, ndmiAfter - ndmiBefore);
  const decayDays = 5;
  const base = baselineDoseMM > 0 ? baselineDoseMM : 15;
  return forecast.map((d, i) => {
    // Remaining lift fraction at day i (1 today → 0 by day decayDays).
    const remain = Math.max(0, 1 - i / decayDays);
    const ndmiOnDay = ndmiBefore + lift * remain;
    let status: RecStatus;
    let dose: number;
    if (ndmiOnDay > 0.2) {
      status = "green";
      dose = 0;
    } else if (ndmiOnDay > 0) {
      status = "yellow";
      // scale by how far below 0.20 we are
      const factor = (0.2 - ndmiOnDay) / 0.2; // 0..1
      dose = Math.round(base * 0.7 * factor * 10) / 10;
    } else {
      status = "red";
      dose = Math.round(base * 1.0 * 10) / 10;
    }
    return { date: d.date, dose_mm: dose, status };
  });
}