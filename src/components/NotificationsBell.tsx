import { useEffect, useState, useCallback } from "react";
import { Bell, Check, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  listNotifications,
  unreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  kindEmoji,
  type AppNotification,
} from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "сега";
  if (m < 60) return `преди ${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `преди ${h} ч`;
  const d = Math.floor(h / 24);
  return `преди ${d} ${d === 1 ? "ден" : "дни"}`;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, c] = await Promise.all([listNotifications(30), unreadCount()]);
      setItems(list);
      setCount(c);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + every 60s
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [refresh]);

  // Realtime subscription
  useEffect(() => {
    const ch = supabase
      .channel("notifications-inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refresh]);

  const handleMarkAll = async () => {
    try {
      await markAllAsRead();
      await refresh();
      toast.success("Всички известия са маркирани като прочетени");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Грешка");
    }
  };

  const handleClick = async (n: AppNotification) => {
    if (!n.read_at) {
      await markAsRead(n.id);
      setItems((arr) => arr.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setCount((c) => Math.max(0, c - 1));
    }
    if (n.action_url) {
      window.location.href = n.action_url;
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteNotification(id);
    setItems((arr) => arr.filter((x) => x.id !== id));
    refresh();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Известия" className="relative">
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold">Известия</h3>
          {count > 0 && (
            <button
              onClick={handleMarkAll}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Check className="h-3 w-3" /> Прочети всички
            </button>
          )}
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Нямаш известия.
            </div>
          ) : (
            <ul>
              {items.map((n) => (
                <li
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`group flex cursor-pointer items-start gap-3 border-b border-border px-4 py-3 hover:bg-accent/30 ${
                    !n.read_at ? "bg-primary/5" : ""
                  }`}
                >
                  <span className="mt-0.5 text-lg">{kindEmoji(n.kind)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className={`truncate text-sm ${!n.read_at ? "font-semibold" : "font-medium"}`}>
                        {n.title}
                      </h4>
                      {!n.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                    </div>
                    {n.body && (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                    )}
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {timeAgo(n.created_at)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(n.id, e)}
                    className="shrink-0 rounded p-1 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    aria-label="Изтрий"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
