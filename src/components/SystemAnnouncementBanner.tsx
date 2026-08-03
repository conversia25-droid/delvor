import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, Megaphone, Wrench, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

type Announcement = {
  id: string;
  title: string;
  message: string;
  severity?: string | null;
  pinned?: boolean | null;
  starts_at?: string | null;
  ends_at?: string | null;
  display_type?: string | null;
};

type MappingRow = { announcement_id: string; company_id: string };

const storagePrefix = "crm:announcement-banner-dismissed:";

function getIcon(severity?: string | null) {
  switch ((severity || "info").toLowerCase()) {
    case "critical":
      return <AlertTriangle className="h-4 w-4 shrink-0" />;
    case "warning":
      return <Wrench className="h-4 w-4 shrink-0" />;
    case "success":
      return <Megaphone className="h-4 w-4 shrink-0" />;
    default:
      return <Info className="h-4 w-4 shrink-0" />;
  }
}

function getClasses(severity?: string | null) {
  switch ((severity || "info").toLowerCase()) {
    case "critical":
      return "border-red-500/30 bg-red-500/10 text-red-100";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-100";
    case "success":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
    default:
      return "border-blue-500/30 bg-blue-500/10 text-blue-100";
  }
}

export default function SystemAnnouncementBanner() {
  const { user, isAuthenticated } = useAuth();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const storageKey = useMemo(() => (announcement ? `${storagePrefix}${announcement.id}` : `${storagePrefix}none`), [announcement]);

  useEffect(() => {
    let active = true;

    async function loadAnnouncement() {
      if (!isAuthenticated) {
        setAnnouncement(null);
        return;
      }
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("system_announcements" as any)
        .select("id,title,message,severity,pinned,starts_at,ends_at,display_type")
        .eq("active", true)
        .or("display_type.eq.banner,display_type.eq.both,display_type.is.null")
        .lte("starts_at", now)
        .or(`ends_at.is.null,ends_at.gte.${now}`)
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(10);

      if (!active) return;
      if (error) {
        console.warn("Falha ao carregar comunicado global:", error.message);
        setAnnouncement(null);
        return;
      }

      const items = (data || []) as Announcement[];
      if (!items.length) {
        setAnnouncement(null);
        return;
      }

      const ids = items.map((item) => item.id);
      const { data: mappings } = await supabase
        .from("system_announcement_companies" as any)
        .select("announcement_id,company_id")
        .in("announcement_id", ids);

      const grouped: Record<string, string[]> = {};
      ((mappings || []) as MappingRow[]).forEach((row) => {
        grouped[row.announcement_id] = [...(grouped[row.announcement_id] || []), row.company_id];
      });

      const next = items.find((item) => {
        const targets = grouped[item.id] || [];
        return !targets.length || (user?.company_id ? targets.includes(user.company_id) : false);
      }) || null;

      setAnnouncement(next);
    }

    void loadAnnouncement();

    const channel = supabase
      .channel("system-announcements-banner")
      .on("postgres_changes", { event: "*", schema: "public", table: "system_announcements" }, () => loadAnnouncement())
      .on("postgres_changes", { event: "*", schema: "public", table: "system_announcement_companies" }, () => loadAnnouncement())
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [isAuthenticated, user?.company_id]);

  useEffect(() => {
    if (!announcement) return setDismissed(false);
    try {
      setDismissed(localStorage.getItem(storageKey) === "1");
    } catch {
      setDismissed(false);
    }
  }, [announcement, storageKey]);

  if (!announcement || dismissed) return null;

  return (
    <div className={`mb-4 rounded-xl border px-4 py-3 shadow-sm ${getClasses(announcement.severity)}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{getIcon(announcement.severity)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <strong className="text-sm font-semibold">{announcement.title}</strong>
            {announcement.pinned ? <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-80">Fixo</span> : null}
          </div>
          <p className="mt-1 text-sm leading-6 opacity-95 whitespace-pre-line">{announcement.message}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-current hover:bg-white/10" onClick={() => {
          try { localStorage.setItem(storageKey, "1"); } catch {}
          setDismissed(true);
        }}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
