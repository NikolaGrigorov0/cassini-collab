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
}

const NDMI_PER_10MM = 0.06;
const FIELD_CAPACITY_NDMI = 0.45;

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
  // crop/phase kept in the signature for forward compatibility (FAO-56 tuning).
  _cropType: string,
  _growthPhase: string,
  originalDoseMM = 0,
  soilType?: string | null,
): CorrectionResult {
  const lift = (doseMM / 10) * NDMI_PER_10MM * soilMultiplier(soilType);
  const correctedNDMI = Math.min(FIELD_CAPACITY_NDMI, currentNDMI + lift);

  // Use the *original* recommended dose as the baseline for follow-up actions
  // — if it wasn't supplied, fall back to the just-applied dose.
  const baseDose = originalDoseMM > 0 ? originalDoseMM : doseMM;

  if (correctedNDMI > 0.2) {
    return {
      correctedNDMI,
      newDose: 0,
      newStatus: "green",
      newReason: "Полято днес. Влагата е достатъчна за следващите 5-7 дни.",
      nextCheckInDays: 5,
    };
  }
  if (correctedNDMI > 0) {
    return {
      correctedNDMI,
      newDose: Math.round(baseDose * 0.7 * 10) / 10,
      newStatus: "yellow",
      newReason: "Полято днес. Препоръчваме допълнително напояване след 3 дни.",
      nextCheckInDays: 3,
    };
  }
  return {
    correctedNDMI,
    newDose: Math.round(baseDose * 1.0 * 10) / 10,
    newStatus: "red",
    newReason: "Полято днес но влагата е критично ниска. Повторете утре.",
    nextCheckInDays: 1,
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