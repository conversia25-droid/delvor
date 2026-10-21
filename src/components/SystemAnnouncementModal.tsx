import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, Megaphone, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Announcement = {
  id: string;
  title: string;
  message: string;
  severity: string | null;
  starts_at: string | null;
  ends_at: string | null;
  display_type?: string | null;
  allow_hide_forever?: boolean | null;
};

type MappingRow = { announcement_id: string; company_id: string };

function getIcon(severity?: string | null) {
  switch ((severity || "info").toLowerCase()) {
    case "critical":
      return <AlertTriangle className="h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />;
    case "warning":
      return <Wrench className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />;
    case "success":
      return <Megaphone className="h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" />;
    default:
      return <Info className="h-5 w-5 shrink-0 text-blue-700 dark:text-blue-400" />;
  }
}

function getAccent(severity?: string | null) {
  switch ((severity || "info").toLowerCase()) {
    case "critical":
      return "border-red-500/30";
    case "warning":
      return "border-amber-500/30";
    case "success":
      return "border-emerald-500/30";
    default:
      return "border-blue-500/30";
  }
}

export default function SystemAnnouncementModal() {
  const { user, isAuthenticated } = useAuth();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [saving, setSaving] = useState(false);

  const channelName = useMemo(() => `system-announcements-modal-${user?.id || "anon"}`, [user?.id]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      setAnnouncement(null);
      setOpen(false);
      return;
    }

    let mounted = true;

    async function loadAnnouncement() {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("system_announcements" as any)
        .select("id,title,message,severity,starts_at,ends_at,display_type,allow_hide_forever,pinned")
        .eq("active", true)
        .or("display_type.eq.popup,display_type.eq.both")
        .lte("starts_at", now)
        .or(`ends_at.is.null,ends_at.gte.${now}`)
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(10);

      if (!mounted) return;
      if (error) {
        console.warn("Falha ao carregar popup global:", error.message);
        setAnnouncement(null);
        setOpen(false);
        return;
      }

      const items = (data || []) as Announcement[];
      if (!items.length) {
        setAnnouncement(null);
        setOpen(false);
        return;
      }

      const ids = items.map((item) => item.id);
      const [{ data: views, error: viewsError }, { data: mappings }] = await Promise.all([
        supabase.from("system_announcement_views" as any).select("announcement_id,dont_show_again").eq("user_id", user.id).in("announcement_id", ids).eq("dont_show_again", true),
        supabase.from("system_announcement_companies" as any).select("announcement_id,company_id").in("announcement_id", ids),
      ]);

      if (!mounted) return;
      if (viewsError) {
        console.warn("Falha ao verificar comunicados ocultados:", viewsError.message);
      }

      const hidden = new Set(((views || []) as any[]).map((row) => row.announcement_id));
      const grouped: Record<string, string[]> = {};
      ((mappings || []) as MappingRow[]).forEach((row) => {
        grouped[row.announcement_id] = [...(grouped[row.announcement_id] || []), row.company_id];
      });

      const next = items.find((item) => {
        if (hidden.has(item.id)) return false;
        const targets = grouped[item.id] || [];
        return !targets.length || (user.company_id ? targets.includes(user.company_id) : false);
      }) || null;
      setAnnouncement(next);
      setDontShowAgain(false);
      setOpen(Boolean(next));
    }

    void loadAnnouncement();

    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "system_announcements" }, () => loadAnnouncement())
      .on("postgres_changes", { event: "*", schema: "public", table: "system_announcement_companies" }, () => loadAnnouncement())
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [channelName, isAuthenticated, user?.id, user?.company_id]);

  async function handleClose() {
    if (!announcement || !user?.id) {
      setOpen(false);
      return;
    }

    setSaving(true);
    const payload = {
      announcement_id: announcement.id,
      user_id: user.id,
      dont_show_again: Boolean(dontShowAgain && announcement.allow_hide_forever !== false),
      dismissed_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("system_announcement_views" as any).upsert(payload as any, { onConflict: "announcement_id,user_id" });
    setSaving(false);

    if (error) {
      console.warn("Falha ao registrar visualização do comunicado:", error.message);
    }

    setOpen(false);
  }

  if (!announcement) return null;

  return (
    <Dialog open={open} onOpenChange={(value) => {
      if (!value) {
        void handleClose();
        return;
      }
      setOpen(value);
    }}>
      <DialogContent className={`sm:max-w-xl ${getAccent(announcement.severity)}`}>
        <DialogHeader>
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-full border border-border p-2">{getIcon(announcement.severity)}</div>
            <div>
              <DialogTitle>Comunicado do sistema</DialogTitle>
              <DialogDescription>Popup exibido automaticamente quando houver aviso ativo para a empresa logada.</DialogDescription>
            </div>
          </div>
          <div className="space-y-2 text-left">
            <h3 className="text-lg font-semibold leading-6">{announcement.title}</h3>
            <p className="text-sm leading-6 text-muted-foreground whitespace-pre-line">{announcement.message}</p>
          </div>
        </DialogHeader>

        {announcement.allow_hide_forever !== false ? (
          <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
            <Checkbox checked={dontShowAgain} onCheckedChange={(checked) => setDontShowAgain(checked === true)} />
            <span>Não mostrar novamente este comunicado</span>
          </label>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => void handleClose()} disabled={saving}>Fechar</Button>
          <Button onClick={() => void handleClose()} disabled={saving}>{saving ? "Salvando..." : "Entendi"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
