import { useTranslation } from "react-i18next";
import { Globe, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SUPPORTED_LANGUAGES, setLanguage, type LangCode } from "@/i18n";

interface Props {
  /** Visual variant: 'icon' (just globe button) or 'full' (button + label). */
  variant?: "icon" | "full";
  align?: "start" | "center" | "end";
}

export function LanguageSelector({ variant = "icon", align = "end" }: Props) {
  const { i18n, t } = useTranslation();
  const current = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ?? SUPPORTED_LANGUAGES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "icon" ? (
          <Button variant="ghost" size="icon" aria-label={t("common.language")} title={current.name}>
            <Globe className="h-5 w-5" />
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="gap-2">
            <Globe className="h-4 w-4" />
            <span>{current.flag}</span>
            <span className="hidden sm:inline">{current.name}</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-52">
        <DropdownMenuLabel>{t("languageSelector.title")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SUPPORTED_LANGUAGES.map((lang) => {
          const active = lang.code === i18n.language;
          return (
            <DropdownMenuItem
              key={lang.code}
              onClick={() => setLanguage(lang.code as LangCode)}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <span aria-hidden>{lang.flag}</span>
                <span>{lang.name}</span>
              </span>
              {active && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
