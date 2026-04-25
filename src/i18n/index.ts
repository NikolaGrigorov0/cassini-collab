import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import bg from "@/locales/bg.json";
import en from "@/locales/en.json";
import ro from "@/locales/ro.json";
import el from "@/locales/el.json";
import tr from "@/locales/tr.json";
import de from "@/locales/de.json";
import fr from "@/locales/fr.json";

// RTL support (ar, he) - not implemented yet

export const SUPPORTED_LANGUAGES = [
  { code: "bg", name: "Български", flag: "🇧🇬" },
  { code: "en", name: "English", flag: "🇬🇧" },
  { code: "ro", name: "Română", flag: "🇷🇴" },
  { code: "el", name: "Ελληνικά", flag: "🇬🇷" },
  { code: "tr", name: "Türkçe", flag: "🇹🇷" },
  { code: "de", name: "Deutsch", flag: "🇩🇪" },
  { code: "fr", name: "Français", flag: "🇫🇷" },
] as const;

export type LangCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

const SUPPORTED_CODES: ReadonlySet<string> = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));

// Map ISO country codes to our supported language codes.
const COUNTRY_TO_LANG: Record<string, LangCode> = {
  BG: "bg",
  RO: "ro",
  GR: "el",
  CY: "el",
  TR: "tr",
  DE: "de",
  AT: "de",
  CH: "de",
  FR: "fr",
  BE: "fr",
  LU: "fr",
};

export const STORAGE_KEY = "preferred_language";

function normalizeLang(input: string | null | undefined): LangCode | null {
  if (!input) return null;
  const code = input.toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_CODES.has(code) ? (code as LangCode) : null;
}

/** Pick the initial language synchronously: stored choice → browser → fallback (en). */
export function pickInitialLanguage(): LangCode {
  if (typeof window === "undefined") return "en";
  const stored = normalizeLang(window.localStorage.getItem(STORAGE_KEY));
  if (stored) return stored;
  const fromBrowser = normalizeLang(navigator.language);
  return fromBrowser ?? "en";
}

/** Best-effort IP geolocation; runs in background and only switches language
 *  if the user has not already made a manual choice. */
export async function autoDetectByGeolocation(): Promise<void> {
  if (typeof window === "undefined") return;
  // Respect any explicit user choice.
  if (window.localStorage.getItem(STORAGE_KEY)) return;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch("https://ipapi.co/json/", { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) return;
    const data = (await res.json()) as { country_code?: string };
    const cc = data.country_code?.toUpperCase();
    if (!cc) return;
    const lang = COUNTRY_TO_LANG[cc] ?? "en";
    if (lang !== i18n.language) {
      await i18n.changeLanguage(lang);
    }
  } catch {
    // network failure or aborted — silent.
  }
}

export function setLanguage(lang: LangCode): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }
  void i18n.changeLanguage(lang);
}

i18n.use(initReactI18next).init({
  resources: {
    bg: { translation: bg },
    en: { translation: en },
    ro: { translation: ro },
    el: { translation: el },
    tr: { translation: tr },
    de: { translation: de },
    fr: { translation: fr },
  },
  lng: pickInitialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

if (typeof window !== "undefined") {
  document.documentElement.lang = i18n.language;
}

export default i18n;

// ----- Locale-aware formatting helpers -----

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(i18n.language, options).format(value);
}

export function formatDate(value: Date | string | number, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(i18n.language, options).format(d);
}
