// In-app inbox notifications.
import { supabase } from "@/integrations/supabase/client";

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  kind: string; // 'info' | 'warning' | 'success' | 'irrigation' | 'phase'
  parcel_id: string | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
}

export async function listNotifications(limit = 30): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AppNotification[];
}

export async function unreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) return 0;
  return count ?? 0;
}

export async function createNotification(input: {
  title: string;
  body?: string;
  kind?: string;
  parcel_id?: string;
  action_url?: string;
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase.from("notifications").insert({
    user_id: user.id,
    title: input.title,
    body: input.body ?? null,
    kind: input.kind ?? "info",
    parcel_id: input.parcel_id ?? null,
    action_url: input.action_url ?? null,
  });
  if (error) throw error;
}

export async function markAsRead(id: string) {
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
}

export async function markAllAsRead() {
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
}

export async function deleteNotification(id: string) {
  await supabase.from("notifications").delete().eq("id", id);
}

export function kindEmoji(kind: string): string {
  switch (kind) {
    case "warning": return "⚠️";
    case "success": return "✅";
    case "irrigation": return "💧";
    case "phase": return "🌱";
    default: return "ℹ️";
  }
}
