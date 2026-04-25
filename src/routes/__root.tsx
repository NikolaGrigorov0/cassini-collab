import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";
import maplibreCss from "maplibre-gl/dist/maplibre-gl.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Страницата не е намерена</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Линкът, който отвори, не съществува или е преместен.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Към началото
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "HydroLand — Умно напояване" },
      { name: "description", content: "Спътникови данни от Copernicus + FAO-56 = точна доза напояване за твоя парцел." },
      { name: "author", content: "HydroLand" },
      { property: "og:title", content: "HydroLand — Умно напояване" },
      { property: "og:description", content: "Полей умно. Спести вода." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: maplibreCss },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23a9c7ee'/><path d='M5 19 Q 9 15, 13 19 T 21 19 T 29 19' stroke='white' stroke-width='2.5' fill='none' stroke-linecap='round'/><path d='M5 24 Q 9 20, 13 24 T 21 24 T 29 24' stroke='white' stroke-width='2.5' fill='none' stroke-linecap='round' opacity='0.8'/><circle cx='16' cy='10' r='3' fill='white'/></svg>",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bg">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster richColors position="top-right" />
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
