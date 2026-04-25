import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { LanguageSelector } from "@/components/LanguageSelector";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Вход — HydroLand" },
      { name: "description", content: "Влез или се регистрирай в HydroLand." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // If already logged in, redirect
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) throw error;
        toast.success(t("auth.createdToast"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success(t("auth.welcomeToast"));
      }
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.genericError"));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/dashboard`,
    });
    if (result.error) {
      toast.error(result.error.message ?? t("auth.googleError"));
      setBusy(false);
      return;
    }
    if (!result.redirected) {
      navigate({ to: "/dashboard" });
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-hero px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-elevated">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <LanguageSelector variant="icon" />
        </div>
        <h1 className="text-center text-2xl font-bold">
          {mode === "login" ? t("auth.loginTitle") : t("auth.signupTitle")}
        </h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {mode === "login" ? t("auth.loginSubtitle") : t("auth.signupSubtitle")}
        </p>

        <Button
          type="button"
          variant="outline"
          className="mt-6 w-full"
          onClick={handleGoogle}
          disabled={busy}
        >
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {t("auth.continueWithGoogle")}
        </Button>

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />{t("auth.orWithEmail")}<div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleEmail} className="space-y-4">
          <div>
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" />
          </div>
          <Button type="submit" disabled={busy} className="w-full bg-primary hover:bg-primary/90">
            {busy ? t("auth.submitting") : mode === "login" ? t("auth.submitLogin") : t("auth.submitSignup")}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {mode === "login" ? t("auth.noAccount") : t("auth.hasAccount")}{" "}
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="font-semibold text-primary hover:underline"
          >
            {mode === "login" ? t("auth.submitSignup") : t("auth.submitLogin")}
          </button>
        </p>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:underline">{t("auth.backHome")}</Link>
        </p>
      </div>
    </div>
  );
}
