import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Eye, Play, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { ParcelMap } from "@/components/ParcelMap";
import { ParcelDetail } from "@/components/ParcelDetail";
import { CROP_ICONS, CROP_LABELS, STATUS_COLORS } from "@/lib/mockData";
import { DEMO_CENTER, DEMO_PARCELS, DEMO_ZOOM } from "@/lib/demoData";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Демо тур — HydroLand" },
      {
        name: "description",
        content:
          "Преминете през интерактивен тур: вижте как HydroLand анализира 4 реални парцела в Добруджа за една седмица.",
      },
    ],
  }),
  component: DemoTour,
});

interface TourStep {
  title: string;
  body: string;
  parcelId?: string;
}

const TOUR: TourStep[] = [
  {
    title: "Добре дошли в Добруджа",
    body:
      "Това е интерактивен тур с 4 реални парцела край Добрич. Ще ви покажем как HydroLand превръща спътникови данни в конкретни решения за тази седмица.",
  },
  {
    title: "Парцел 1: Пшеницата чака",
    body:
      "Добруджанска нива №7 (12.4 ха пшеница) показва спадащ NDMI. Спътникът е засякъл нуждата 3 дни преди агрономът да усети сухота на терен.",
    parcelId: "d1",
  },
  {
    title: "Парцел 2: Спести вода",
    body:
      "Слънчогледовото поле Юг е със здрави стойности. HydroLand препоръчва нула поливане — очаквани 8mm дъжд. Това са ~150 000 л спестена вода за един ден.",
    parcelId: "d2",
  },
  {
    title: "Парцел 3: Червен сигнал",
    body:
      "Царевицата при Дунавския бряг е в спешно състояние. Без намеса — 15-20% по-малък добив. С HydroLand — навременно поливане и спасена реколта.",
    parcelId: "d3",
  },
  {
    title: "Готови сте",
    body:
      "Видяхте как работи HydroLand. Сега опитайте със собствен парцел — само ще трябва да го очертаете на картата.",
  },
];

function DemoTour() {
  const [stepIdx, setStepIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tourOpen, setTourOpen] = useState(true);

  const step = TOUR[stepIdx];

  // Auto-select parcel for the current step
  useEffect(() => {
    if (step.parcelId) setSelectedId(step.parcelId);
    else setSelectedId(null);
  }, [step]);

  const selected = DEMO_PARCELS.find((p) => p.id === selectedId) ?? null;
  const totals = {
    parcels: DEMO_PARCELS.length,
    hectares: DEMO_PARCELS.reduce((a, p) => a + p.area_hectares, 0).toFixed(1),
    waterSaved: 18400, // litres — illustrative
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Top bar — visually distinct from dashboard (uses primary background) */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-gradient-primary px-3 sm:px-4">
        <div className="flex items-center gap-3">
          <Link to="/">
            <Button variant="ghost" size="icon" aria-label="Към началото">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <Logo />
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-card/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-primary-foreground backdrop-blur">
            <Sparkles className="h-3 w-3" /> Демо тур
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/dashboard">
            <Button size="sm" variant="secondary" className="bg-card text-foreground hover:bg-card/80">
              Изпробвай със свой парцел
            </Button>
          </Link>
        </div>
      </header>

      {/* Region/context strip */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-foreground">📍 Добруджа, NE България</span>
          <span className="text-muted-foreground">
            {totals.parcels} парцела · {totals.hectares} ха · седмица 17 / 2026
          </span>
        </div>
        <span className="hidden text-primary sm:inline">~{totals.waterSaved.toLocaleString("bg-BG")} л спестени тази седмица</span>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        {/* Side panel: parcel cards (visually different — horizontal numbered chips on top of map) */}
        <main className="relative flex-1 overflow-hidden">
          <ParcelMap
            parcels={DEMO_PARCELS}
            selectedId={selectedId}
            onSelect={setSelectedId}
            center={DEMO_CENTER}
            zoom={DEMO_ZOOM}
          />

          {/* Parcel quick-jump chips (top of map) */}
          <div className="pointer-events-auto absolute left-1/2 top-4 z-10 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-full border border-border bg-card/95 p-1.5 shadow-elevated backdrop-blur">
            {DEMO_PARCELS.map((p, i) => {
              const s = STATUS_COLORS[p.status];
              const active = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold" style={{ backgroundColor: active ? "rgba(255,255,255,0.25)" : `${s.fill}25`, color: active ? "white" : s.fill }}>
                    {i + 1}
                  </span>
                  <span className="hidden sm:inline">{CROP_ICONS[p.crop_type]} {p.name}</span>
                  <span className="sm:hidden">{CROP_ICONS[p.crop_type]}</span>
                </button>
              );
            })}
          </div>

          {/* Tour overlay — bottom center, shifted left when the right-side parcel panel is open */}
          {tourOpen && (
            <div
              className={`pointer-events-auto absolute bottom-6 z-30 w-[min(560px,calc(100%-2rem))] animate-fade-in ${
                selected
                  ? "left-4 sm:left-6 md:left-1/2 md:-translate-x-[calc(50%+210px)]"
                  : "left-1/2 -translate-x-1/2"
              }`}
            >
              <div className="rounded-2xl border-2 border-primary/40 bg-card/98 p-5 shadow-elevated backdrop-blur">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
                        Стъпка {stepIdx + 1} / {TOUR.length}
                      </span>
                      {step.parcelId && (
                        <span className="text-[11px] text-muted-foreground">
                          ↑ виж избрания парцел в картата
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-foreground sm:text-lg">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                  </div>
                  <button
                    onClick={() => setTourOpen(false)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                    aria-label="Затвори тура"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Progress dots */}
                <div className="mt-4 flex items-center justify-center gap-1.5">
                  {TOUR.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setStepIdx(i)}
                      className={`h-1.5 rounded-full transition-all ${
                        i === stepIdx ? "w-8 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground/40"
                      }`}
                      aria-label={`Стъпка ${i + 1}`}
                    />
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={stepIdx === 0}
                    onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
                  >
                    <ArrowLeft className="mr-1 h-4 w-4" /> Назад
                  </Button>
                  {stepIdx < TOUR.length - 1 ? (
                    <Button size="sm" className="bg-primary hover:bg-primary/90" onClick={() => setStepIdx((i) => i + 1)}>
                      Напред <ArrowRight className="ml-1 h-4 w-4" />
                    </Button>
                  ) : (
                    <Link to="/dashboard">
                      <Button size="sm" className="bg-primary hover:bg-primary/90">
                        Към таблото <ArrowRight className="ml-1 h-4 w-4" />
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Reopen tour button when closed */}
          {!tourOpen && (
            <button
              onClick={() => setTourOpen(true)}
              className={`absolute bottom-6 z-30 rounded-full border border-primary/40 bg-card px-4 py-2 text-sm font-semibold text-primary shadow-elevated hover:bg-primary/10 ${
                selected
                  ? "left-4 sm:left-6 md:left-1/2 md:-translate-x-[calc(50%+210px)]"
                  : "left-1/2 -translate-x-1/2"
              }`}
            >
              <Play className="mr-1.5 inline h-3.5 w-3.5" /> Продължи тура
            </button>
          )}

          {selected && <ParcelDetail parcel={selected} onClose={() => setSelectedId(null)} />}

          {/* Read-only badge */}
          <div className="absolute right-4 top-20 z-10 hidden items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-card backdrop-blur sm:inline-flex">
            <Eye className="h-3 w-3" />
            Само за преглед — данните не се записват
          </div>
        </main>
      </div>

      {/* Sticky bottom CTA on small screens */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-2 sm:hidden">
        <Link to="/dashboard">
          <Button className="w-full bg-primary hover:bg-primary/90">
            Изпробвай със свой парцел <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* Hidden legend for crop labels (used by sr-only announcement) */}
      <span className="sr-only">{Object.values(CROP_LABELS).join(", ")}</span>
    </div>
  );
}
