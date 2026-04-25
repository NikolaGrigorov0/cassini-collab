import { createFileRoute, Link } from "@tanstack/react-router";
import { Droplets, Satellite, MapPinned, ArrowRight, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { TryItYourselfMini } from "@/components/TryItYourselfMini";
import { CROP_ICONS, CROP_LABELS } from "@/lib/mockData";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HydroLand — Умно напояване" },
      { name: "description", content: "Спътникови данни от Copernicus + FAO-56 = точна доза напояване за твоя парцел." },
      { property: "og:title", content: "HydroLand — Умно напояване" },
      { property: "og:description", content: "Полей умно. Спести вода. Спътниковo базирани препоръки за напояване." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-2">
            <LanguageSelector variant="icon" />
            <Link to="/demo">
              <Button variant="ghost" size="sm">{t("landing.nav.demo")}</Button>
            </Link>
            <Link to="/auth">
              <Button variant="ghost" size="sm">{t("landing.nav.login")}</Button>
            </Link>
            <Link to="/dashboard">
              <Button size="sm" className="bg-primary hover:bg-primary/90">{t("landing.nav.tryIt")}</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-hero">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'><path d='M0 60 L60 0 L120 60 L60 120 Z' fill='none' stroke='%23166534' stroke-width='0.5'/><circle cx='60' cy='60' r='30' fill='none' stroke='%23166534' stroke-width='0.3'/></svg>\")",
            backgroundSize: "120px 120px",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto max-w-3xl text-center animate-fade-in">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              <Satellite className="h-3.5 w-3.5" />
              {t("landing.hero.badge")}
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
              {t("landing.hero.title1")} <span className="text-primary">{t("landing.hero.title2")}</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
              {t("landing.hero.subtitle")}
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href="#try-it-yourself">
                <Button size="lg" className="h-12 bg-primary px-6 text-base hover:bg-primary/90 shadow-elevated">
                  {t("landing.hero.ctaPrimary")} <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </a>
              <Link to="/demo">
                <Button size="lg" variant="outline" className="h-12 px-6 text-base border-primary/40 hover:bg-primary/10">
                  {t("landing.hero.ctaSecondary")}
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="relative border-t border-border/60 bg-background/60 backdrop-blur">
          <div className="mx-auto grid max-w-6xl grid-cols-1 divide-y divide-border/60 px-4 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-6">
            {[
              { v: "70%", l: t("landing.stats.s1Label") },
              { v: t("landing.stats.s2Value"), l: t("landing.stats.s2Label") },
              { v: "10 m", l: t("landing.stats.s3Label") },
            ].map((s) => (
              <div key={s.v} className="px-2 py-6 text-center">
                <div className="text-3xl font-bold text-primary">{s.v}</div>
                <div className="mt-1 text-sm text-muted-foreground">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("landing.how.title")}</h2>
          <p className="mt-3 text-muted-foreground">{t("landing.how.subtitle")}</p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {[
            { icon: MapPinned, title: t("landing.how.s1Title"), desc: t("landing.how.s1Desc") },
            { icon: Satellite, title: t("landing.how.s2Title"), desc: t("landing.how.s2Desc") },
            { icon: Droplets, title: t("landing.how.s3Title"), desc: t("landing.how.s3Desc") },
          ].map((s, i) => (
            <div key={s.title} className="relative rounded-2xl border border-border bg-card p-6 shadow-card transition hover:shadow-elevated">
              <div className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">
                {t("landing.how.step")} {i + 1}
              </div>
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <s.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Try it yourself - interactive */}
      <TryItYourselfMini />

      {/* Crops */}
      <section className="border-y border-border bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="text-center">
            <Sprout className="mx-auto h-8 w-8 text-primary" />
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{t("landing.crops.title")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("landing.crops.subtitle")}</p>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {(Object.keys(CROP_LABELS) as Array<keyof typeof CROP_LABELS>).map((c) => (
              <div
                key={c}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-card"
              >
                <span className="text-lg">{CROP_ICONS[c]}</span>
                {t(`crops.${c}`)}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-background">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <Logo />
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>Powered by</span>
            {["Copernicus", "Galileo", "ESA"].map((p) => (
              <span key={p} className="rounded-md border border-border bg-muted px-2 py-1 font-mono font-medium text-foreground">
                {p}
              </span>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
