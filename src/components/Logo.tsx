import { Waves } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2 ${className}`}>
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-elevated">
        <Waves className="h-5 w-5 text-primary-foreground" strokeWidth={2.5} />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-lg font-bold tracking-tight text-foreground">HydroLand</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Smart irrigation</span>
      </div>
    </Link>
  );
}
