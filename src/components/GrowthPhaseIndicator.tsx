import { Check, Info, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CropType, GrowthPhase } from "@/lib/mockData";

const PHASES: GrowthPhase[] = ["initial", "development", "mid", "late"];

const PHASE_BG: Record<GrowthPhase, string> = {
  initial: "Начална",
  development: "Развитие",
  mid: "Средна",
  late: "Финална",
};

const PHASE_DURATION: Record<GrowthPhase, string> = {
  initial: "1-4 сед.",
  development: "4-8 сед.",
  mid: "8-12 сед.",
  late: "12+ сед.",
};

const CROP_EMOJI: Record<CropType, string> = {
  wheat: "🌾",
  corn: "🌽",
  tomatoes: "🍅",
  sunflower: "🌻",
  vineyard: "🍇",
};

const CROP_NAME_BG: Record<CropType, string> = {
  wheat: "Пшеница",
  corn: "Царевица",
  tomatoes: "Домати",
  sunflower: "Слънчоглед",
  vineyard: "Лозе",
};

const WATER_NEED: Record<CropType, Record<GrowthPhase, string>> = {
  wheat: {
    initial: "Ниска нужда от вода — коренова система се развива",
    development: "Нарастваща нужда — братене и стъблообразуване",
    mid: "Висока нужда — изкласяване и зърнообразуване",
    late: "Намаляваща нужда — узряване на зърното",
  },
  corn: {
    initial: "Ниска нужда — поникване и ранен растеж",
    development: "Нарастваща нужда — интензивен вегетативен растеж",
    mid: "Критична фаза! Опрашване и зърнообразуване",
    late: "Намаляваща нужда — узряване",
  },
  tomatoes: {
    initial: "Умерена нужда — вкореняване на разсада",
    development: "Нарастваща нужда — вегетативен растеж",
    mid: "Висока нужда! Цъфтеж и завързване на плодове",
    late: "Умерена нужда — узряване на плодовете",
  },
  sunflower: {
    initial: "Ниска нужда — поникване",
    development: "Умерена нужда — листна розетка",
    mid: "Висока нужда — цъфтеж и опрашване",
    late: "Ниска нужда — узряване на семената",
  },
  vineyard: {
    initial: "Умерена нужда — разпукване на пъпки",
    development: "Умерена нужда — цъфтеж",
    mid: "Висока нужда — наедряване на гроздето",
    late: "Ниска нужда — узряване и захарообразуване",
  },
};

// FAO-56 Kc values (matches src/integrations/agri/fao56.ts).
const KC: Record<CropType, Record<GrowthPhase, number>> = {
  wheat: { initial: 0.3, development: 0.75, mid: 1.15, late: 0.4 },
  corn: { initial: 0.3, development: 0.75, mid: 1.2, late: 0.6 },
  tomatoes: { initial: 0.4, development: 0.75, mid: 1.15, late: 0.8 },
  sunflower: { initial: 0.35, development: 0.75, mid: 1.15, late: 0.35 },
  vineyard: { initial: 0.3, development: 0.7, mid: 0.85, late: 0.45 },
};

interface Props {
  cropType: CropType;
  growthPhase: GrowthPhase;
  onChangePhase?: () => void;
}

export function GrowthPhaseIndicator({ cropType, growthPhase, onChangePhase }: Props) {
  const currentIdx = PHASES.indexOf(growthPhase);
  const isLate = growthPhase === "late";
  const kc = KC[cropType][growthPhase];

  return (
    <div className="space-y-3">
      {/* PART 1: Progress bar */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="mb-3 flex items-center gap-2">
          <Sprout className="h-4 w-4 text-emerald-600" />
          <h3 className="text-sm font-semibold">Фаза на растеж</h3>
        </div>
        <div className="relative px-1">
          {/* Connector lines */}
          <div className="absolute left-[12%] right-[12%] top-3 flex h-[3px] items-center">
            {[0, 1, 2].map((i) => {
              const completed = i < currentIdx;
              return (
                <div
                  key={i}
                  className={`h-full flex-1 ${
                    completed ? "bg-emerald-400" : "bg-gray-200 dark:bg-gray-700"
                  }`}
                />
              );
            })}
          </div>

          {/* Nodes */}
          <div className="relative flex items-start justify-between">
            {PHASES.map((p, i) => {
              const isCurrent = i === currentIdx;
              const isCompleted = i < currentIdx;
              return (
                <div key={p} className="flex w-1/4 flex-col items-center">
                  <div
                    className={`relative flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                      isCurrent
                        ? "border-white bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.25)] dark:border-emerald-950"
                        : isCompleted
                        ? "border-white bg-gray-400 dark:border-gray-900 dark:bg-gray-500"
                        : "border-gray-300 bg-card dark:border-gray-600"
                    }`}
                  >
                    {isCurrent && (
                      <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-60" />
                    )}
                    {isCompleted && <Check className="h-3 w-3 text-white" />}
                  </div>
                  <div
                    className={`mt-2 text-xs ${
                      isCurrent
                        ? "font-semibold text-emerald-700 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {PHASE_BG[p]}
                  </div>
                  <div className="text-[10px] text-muted-foreground/80">
                    {PHASE_DURATION[p]}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* PART 2 + 3: Crop + phase info card */}
      <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
        <div className="flex items-start gap-3">
          <div className="text-3xl leading-none">{CROP_EMOJI[cropType]}</div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">{CROP_NAME_BG[cropType]}</div>
            <div className="text-sm font-bold text-foreground">
              {PHASE_BG[growthPhase]} фаза
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {WATER_NEED[cropType][growthPhase]}
            </p>
            <div className="mt-2 flex justify-end">
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                      Kc = {kc.toFixed(2)}
                      <Info className="h-2.5 w-2.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    Коефициент на водопотребление (FAO-56). По-висок Kc = повече вода
                    за тази фаза.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>
      </div>

      {/* PART 4: Phase change reminder */}
      {!isLate ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="mt-0.5">📅</span>
          <div className="flex-1">
            <p>
              Не забравяй да обновиш фазата на растеж когато културата премине в
              следващия етап — това влияе на препоръките за напояване.
            </p>
            {onChangePhase && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 h-7 border-amber-300 bg-white text-xs text-amber-900 hover:bg-amber-100 dark:bg-amber-900/40"
                onClick={onChangePhase}
              >
                Смени фазата →
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          <Check className="h-4 w-4" />
          <span>✓ Финална фаза — подготовка за прибиране на реколтата.</span>
        </div>
      )}
    </div>
  );
}

/** Sidebar pill: small dot + phase name in Bulgarian. */
const PHASE_DOT: Record<GrowthPhase, string> = {
  initial: "bg-gray-400",
  development: "bg-yellow-400",
  mid: "bg-emerald-500",
  late: "bg-blue-500",
};

export function PhasePill({ phase }: { phase: GrowthPhase }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${PHASE_DOT[phase]}`} />
      {PHASE_BG[phase]}
    </span>
  );
}