import {
  Home,
  Users,
  UserPlus,
  MessageSquare,
  Mail,
  Settings,
  Bell,
  Trash2,
  X,
  LogOut,
  Volume2,
  VolumeX,
  CircleHelp,
  ChevronLeft,
  ShieldCheck,
  ListChecks,
  Wrench,
  Package,
  PackageOpen,
  Truck,
  Tags,
  Building2,
  Calendar,
  Repeat,
  Wallet,
  BarChart3,
  FileText,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "./NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "./ui/badge";
import BrandLogo from "@/components/BrandLogo";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, useLocation } from "react-router-dom";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";

/* =========================================================
   NAVIGATION COM CONTROLE DE PAPEL
========================================================= */
/**
 * Navegação Delvor por papel:
 *  - admin: tudo + Configurações + Equipe
 *  - gerente: tudo, sem Configurações
 *  - vendedor (e "user" legado): Dashboard, Clientes, OS, Vendas, Chat
 *  - tecnico: Dashboard, Clientes, OS, Estoque (leitura)
 *
 * Itens "Em breve": Agenda, Relatórios — ainda não foram refeitos pra Delvor.
 */
const navigation = [
  { name: "Dashboard",    href: "/dashboard",      icon: Home,         roles: ["admin", "gerente", "vendedor", "tecnico", "user"] },
  { name: "Clientes",     href: "/customers",      icon: Building2,    roles: ["admin", "gerente", "vendedor", "tecnico", "user"] },
  { name: "Chat",         href: "/chat",           icon: MessageSquare, isChat: true, roles: ["admin", "gerente", "vendedor", "user"] },
  { name: "OS",           href: "/service-orders", icon: Wrench,       roles: ["admin", "gerente", "vendedor", "tecnico", "user"] },
  { name: "Agenda",       href: "/schedule",       icon: Calendar,     roles: ["admin", "gerente", "vendedor", "tecnico", "user"] },
  { name: "PDV / Vendas", href: "/pdv",            icon: Wallet,       roles: ["admin", "gerente", "vendedor", "user"] },
  { name: "Orçamentos",   href: "/orcamentos",     icon: FileText,     roles: ["admin", "gerente", "vendedor", "user"] },
  { name: "Locações",     href: "/rentals",        icon: Repeat,       roles: ["admin", "gerente", "vendedor", "tecnico", "user"] },
  { name: "Estoque",      href: "/products",       icon: Package,      roles: ["admin", "gerente", "tecnico"] },
  { name: "Catálogo",     href: "/services",       icon: Tags,         roles: ["admin", "gerente"] },
  { name: "Fornecedores", href: "/suppliers",      icon: Truck,        roles: ["admin", "gerente"] },
  { name: "Compras",      href: "/purchases",      icon: PackageOpen,  roles: ["admin", "gerente"] },
  { name: "Relatórios",   href: "/reports",        icon: BarChart3,    roles: ["admin", "gerente"] },
  { name: "Equipe",       href: "/team",           icon: Users,        roles: ["admin"] },
  { name: "Configurações",href: "/settings",       icon: Settings,     roles: ["admin"] },
  { name: "Ajuda",        href: "/ajuda",          icon: CircleHelp,   roles: ["admin", "gerente", "vendedor", "tecnico", "user"] },
];

export default function Sidebar() {
  const { hasRole, logout, user, isManager } = useAuth();
  const isAdmin = hasRole("admin");
  const isGerente = hasRole("gerente");
  const companyId = user?.company_id;
  const navigate = useNavigate();
  const location = useLocation();
  const { isOnboarding, isPathAllowed, allowedPath } = useOnboarding();

  // Plano da empresa (para esconder itens restritos)
  const [planCode, setPlanCode] = useState<string | null>(null);
  useEffect(() => {
    if (!companyId) return;
    (async () => {
      const { data } = await supabase
        .from("v_company_billing_summary" as any)
        .select("plan_code")
        .eq("company_id", companyId)
        .maybeSingle();
      setPlanCode((data as any)?.plan_code || null);
    })();
  }, [companyId]);

  // Quando o admin está "vendo como" um usuário via ?user=UUID, as contagens de mensagens devem respeitar esse filtro.
  const urlUserFilter = useMemo(() => {
    try {
      return new URLSearchParams(location.search).get("user");
    } catch {
      return null;
    }
  }, [location.search]);

  const targetAssignedUserId = useMemo(() => {
    if (!user?.id) return null;
    if (!isManager) return user.id;
    return urlUserFilter || null;
  }, [isManager, urlUserFilter, user?.id]);

  // =========================================================
  // 🔔 Bell-only dismiss state (não mexe no read_at do WhatsApp)
  // =========================================================
  // Objetivo: ao clicar em "marcar como lida" no sininho, apenas
  // limpar o badge do sininho (mensagens), sem marcar TODAS as
  // mensagens como lidas no banco.
  // Persistência: localStorage (por company/user e filtro admin).

  const bellStorageKey = useMemo(() => {
    const uid = user?.id || "anon";
    const cid = companyId || "noc";
    // Se admin está "vendo como" um usuário, mantém escopo separado
    const scope = isAdmin ? (urlUserFilter || "all") : uid;
    return `crm:bellDismiss:wpp:${cid}:${scope}`;
  }, [companyId, user?.id, isAdmin, urlUserFilter]);

  type BellDismissState = {
    /** dismiss global (todas conversas) */
    all?: string; // ISO
    /** dismiss por conversa */
    byJid?: Record<string, string>; // remote_jid -> ISO
  };

  const readBellDismissState = (): BellDismissState => {
    try {
      const raw = localStorage.getItem(bellStorageKey);
      if (!raw) return { byJid: {} };
      const parsed = JSON.parse(raw);
      return {
        all: typeof parsed?.all === "string" ? parsed.all : undefined,
        byJid: typeof parsed?.byJid === "object" && parsed?.byJid ? parsed.byJid : {},
      };
    } catch {
      return { byJid: {} };
    }
  };

  const writeBellDismissState = (next: BellDismissState) => {
    try {
      localStorage.setItem(
        bellStorageKey,
        JSON.stringify({ all: next.all, byJid: next.byJid || {} })
      );
    } catch {
      // ignore
    }
  };

  const dismissBellForLead = (remoteJid: string, iso: string) => {
    if (!remoteJid) return;
    const cur = readBellDismissState();
    const byJid = { ...(cur.byJid || {}) };
    byJid[remoteJid] = iso;
    writeBellDismissState({ ...cur, byJid });
  };

  const dismissBellForAll = (iso: string) => {
    const cur = readBellDismissState();
    writeBellDismissState({ ...cur, all: iso });
  };


const [showNotifications, setShowNotifications] = useState(false);

// 🔇 Silenciar som de notificações (persistido em localStorage)
const [soundMuted, setSoundMuted] = useState<boolean>(() => {
  try {
    return localStorage.getItem("crm:soundMuted") === "1";
  } catch {
    return false;
  }
});

useEffect(() => {
  try {
    localStorage.setItem("crm:soundMuted", soundMuted ? "1" : "0");
  } catch {
    // ignore
  }
  // avisa outros componentes (ex.: NotificationToast)
  window.dispatchEvent(new CustomEvent("crm-sound-muted-changed", { detail: { muted: soundMuted } }));
}, [soundMuted]);

// 🌐 Janela web (ex.: TikTok)
const [webViewOpen, setWebViewOpen] = useState(false);
const [webViewUrl, setWebViewUrl] = useState<string>("https://www.tiktok.com/");

// Permite abrir a janela web a partir de qualquer lugar do app
useEffect(() => {
  const handler = (ev: Event) => {
    const custom = ev as CustomEvent<{ url?: string }>;
    const url = custom?.detail?.url;
    if (url) setWebViewUrl(url);
    setWebViewOpen(true);
  };
  window.addEventListener("crm-webview-open", handler as EventListener);
  return () => window.removeEventListener("crm-webview-open", handler as EventListener);
}, []);


// 🔔 Central do sininho: Notificações (sistema) + Mensagens (WhatsApp)
const [panelTab, setPanelTab] = useState<"notifications" | "messages">("messages");
const [sysNotifs, setSysNotifs] = useState<any[]>([]);
const [msgNotifs, setMsgNotifs] = useState<any[]>([]);
const [sysUnreadCount, setSysUnreadCount] = useState(0);
// 🔔 contagem por LEAD (distinct remote_jid) — usada no sininho
const [msgUnreadCount, setMsgUnreadCount] = useState(0);
// 💬 contagem por MENSAGEM (linhas) — usada no badge do menu Chat
const [chatUnreadCount, setChatUnreadCount] = useState(0);

// usado no ícone "Chat" do menu
const unreadCount = chatUnreadCount;

  /* =========================================================
   HELPERS (DATA)
========================================================= */


function formatConversationPreview(m: { message?: string | null; message_type?: string | null }) {
  return (
    m.message ||
    (m.message_type === "audio"
      ? "🎙️ Áudio"
      : m.message_type === "image"
      ? "🖼️ Imagem"
      : m.message_type === "video"
      ? "🎥 Vídeo"
      : m.message_type === "document"
      ? "📄 Documento"
      : "Nova mensagem")
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}


function renderSysNotifIcon(type?: string) {
  const t = (type || "").toLowerCase();
  if (t === "lead_assigned" || t.includes("lead")) return <UserPlus className="h-4 w-4 text-primary" />;
  if (t.includes("agenda") || t.includes("event") || t.includes("reminder")) return <ListChecks className="h-4 w-4 text-primary" />;
  return <Bell className="h-4 w-4 text-primary" />;
}


/* =========================================================
   LOADERS
========================================================= */
async function loadSysNotifications() {
  if (!companyId || !user?.id) return;

  const { data: list, error: listError } = await supabase
    .from("notifications")
    .select("id,type,title,body,meta,created_at,read")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  if (listError) {
    console.error("Erro ao carregar notifications:", listError);
    setSysNotifs([]);
  } else {
    setSysNotifs(list || []);
  }

  const { count, error: countError } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .eq("read", false);

  if (countError) {
    console.error("Erro ao contar notifications não lidas:", countError);
    setSysUnreadCount(0);
  } else {
    setSysUnreadCount(count || 0);
  }
}

async function loadUnreadMessages() {
  if (!companyId || !user?.id) return;

  // Buscamos um volume maior de mensagens não lidas (linhas),
  // e consolidamos em "leads com pendência" (distinct remote_jid).
  let qList = supabase
    .from("wpp_conversations")
    .select("id,remote_jid,message,message_type,created_at,assigned_user_id,read_at,from_me")
    .eq("company_id", companyId)
    .eq("from_me", false)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(500);

  // Contagem real de linhas (para badge do menu Chat)
  let qCount = supabase
    .from("wpp_conversations")
    .select("*", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("from_me", false)
    .is("read_at", null);

  if (targetAssignedUserId) {
    qList = qList.eq("assigned_user_id", targetAssignedUserId);
    qCount = qCount.eq("assigned_user_id", targetAssignedUserId);
  }

  const [{ data: list, error: listError }, { count, error: countError }] = await Promise.all([
    qList,
    qCount,
  ]);

  if (listError) {
    console.error("Erro ao carregar mensagens não lidas:", listError);
    setMsgNotifs([]);
    setMsgUnreadCount(0);
  } else {
    const rows = (list || []) as any[];

    // 🔔 Filtro do sininho: só conta como "pendente" se houver mensagem
    // não lida APÓS o último dismiss (global ou por jid).
    const dismiss = readBellDismissState();
    const allDismissAt = dismiss?.all ? Date.parse(dismiss.all) : 0;

    const isPendingForBell = (r: any) => {
      const jid = r?.remote_jid;
      const createdAt = r?.created_at ? Date.parse(r.created_at) : 0;
      const perJidDismissAt = jid && dismiss?.byJid?.[jid] ? Date.parse(dismiss.byJid[jid]) : 0;
      const threshold = Math.max(allDismissAt, perJidDismissAt);
      return createdAt > threshold;
    };

    // consolida por lead (remote_jid) pegando a última mensagem.
// - msgNotifs: TOP 5 leads (última msg de cada)
// - msgUnreadCount: total de leads com mensagens não lidas (distinct remote_jid)
    const seen = new Set<string>();
    const grouped: any[] = [];
    for (const r of rows) {
      const jid = r?.remote_jid;
      if (!jid) continue;

      // ✅ Apenas pendências do sininho (não altera badge do menu Chat)
      if (!isPendingForBell(r)) continue;

      if (!seen.has(jid)) {
        seen.add(jid);

        // primeiros 5 leads entram no preview
        if (grouped.length < 5) {
          grouped.push(r); // já está em ordem desc, então este é o "último" do lead
        }
      }
    }

    setMsgNotifs(grouped);
    setMsgUnreadCount(seen.size);
  }

  if (countError) {
    console.error("Erro ao contar mensagens não lidas:", countError);
    setChatUnreadCount(0);
  } else {
    setChatUnreadCount(count || 0);
  }
}

/* =========================================================
   INIT + REALTIME
========================================================= */
useEffect(() => {
  if (!companyId || !user?.id) return;

  let cancelled = false;

  async function init() {
    await Promise.all([loadSysNotifications(), loadUnreadMessages()]);
  }

  init();

  const ch1 = supabase
    .channel(`sidebar-notifications-${companyId}-${user.id}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notifications", filter: `company_id=eq.${companyId}` },
      (payload: any) => {
        if (cancelled) return;
        const row = payload?.new || payload?.old;
        if (!row) return;
        if (row.user_id !== user.id) return;
        loadSysNotifications();
      }
    )
    .subscribe();

  const ch2 = supabase
    .channel(`sidebar-unread-messages-${companyId}-${user.id}-${isAdmin ? "admin" : "user"}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "wpp_conversations", filter: `company_id=eq.${companyId}` },
      (payload: any) => {
        if (cancelled) return;
        const row = payload?.new || payload?.old;
        if (!row) return;
        if (row.from_me === true) return;
                if (targetAssignedUserId && row.assigned_user_id !== targetAssignedUserId) return;

        loadUnreadMessages();
      }
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(ch1);
    supabase.removeChannel(ch2);
  };
}, [companyId, user?.id, isAdmin, targetAssignedUserId]);

  /* =========================================================
     CLICK OUTSIDE NOTIFICAÇÕES
  ========================================================= */
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-notification-panel]")) {
        setShowNotifications(false);
      }
    }

    if (showNotifications) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showNotifications]);

  /* =========================================================
     FILTRO DE MENU POR PAPEL
  ========================================================= */
  const filteredNavigation = navigation.filter((item) => {
    if (!item.roles.some((role) => hasRole(role))) return false;
    // Esconder TV Wallboard para planos Starter e Pro
    if (item.href === "/tv/wallboard" && (planCode === "starter" || planCode === "pro")) return false;
    return true;
  });

const totalBellUnread = useMemo(() => sysUnreadCount + msgUnreadCount, [sysUnreadCount, msgUnreadCount]);

async function markAllSysAsRead() {
  if (!companyId || !user?.id) return;
  await supabase
    .from("notifications")
    .update({ read: true })
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .eq("read", false);
  await loadSysNotifications();
}

async function clearReadSysNotifications() {
  if (!companyId || !user?.id) return;
  await supabase
    .from("notifications")
    .delete()
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .eq("read", true);
  await loadSysNotifications();
}

async function deleteAllSysNotifications() {
  if (!companyId || !user?.id) return;
  const ok = window.confirm("Tem certeza que deseja apagar TODAS as suas notificações? Essa ação não pode ser desfeita.");
  if (!ok) return;
  await supabase.from("notifications").delete().eq("company_id", companyId).eq("user_id", user.id);
  await loadSysNotifications();
}

async function markLeadMessagesAsRead(remoteJid: string) {
  // ✅ NÃO marca no banco (read_at). Apenas limpa o badge do sininho.
  if (!companyId || !remoteJid) return;
  const nowIso = new Date().toISOString();
  dismissBellForLead(remoteJid, nowIso);
  await loadUnreadMessages();
}

async function markAllMessagesAsRead() {
  // ✅ NÃO marca no banco (read_at). Apenas limpa o badge do sininho.
  if (!companyId || !user?.id) return;
  const nowIso = new Date().toISOString();
  dismissBellForAll(nowIso);
  await loadUnreadMessages();
}

function buildChatUrl(remoteJid: string) {
  const params = new URLSearchParams();
  params.set("jid", remoteJid);
  // Mantém o modo "ver como usuário" do admin (se existir)
  if (urlUserFilter) params.set("user", urlUserFilter);
  return `/chat?${params.toString()}`;
}

function openChat(remoteJid: string) {
  if (!remoteJid) return;
  // Ao abrir o chat, faz sentido "silenciar" o sininho daquela conversa
  // sem alterar o read_at no banco.
  try {
    dismissBellForLead(remoteJid, new Date().toISOString());
  } catch {
    // ignore
  }
  navigate(buildChatUrl(remoteJid));
}

function openAgenda(taskId?: string) {
  if (taskId) {
    window.location.href = `/agenda?task=${taskId}`;
    return;
  }
  window.location.href = `/agenda`;
}

  const [collapsed, setCollapsed] = useSidebarCollapsed();
  /* Quando collapsed=true, desligamos as variantes `lg:` que alargavam o sidebar. */
  const lgShowInline = collapsed ? "hidden" : "hidden lg:inline";
  const lgShowFlex   = collapsed ? "hidden" : "hidden lg:flex";
  const lgShowIFlex  = collapsed ? "hidden" : "hidden lg:inline-flex";
  const lgHide       = collapsed ? "flex" : "lg:hidden flex";
  const lgPx6        = collapsed ? "px-2" : "px-2 lg:px-6";
  const lgPx3        = collapsed ? "px-2" : "px-2 lg:px-3";
  const lgJustifyStart = collapsed ? "justify-center" : "justify-center lg:justify-start";
  const asideWidth   = collapsed ? "w-16" : "w-16 lg:w-64";

  const itemBase = `
    flex items-center gap-3
    rounded-lg
    py-2.5
    ${lgPx3}
    text-sm font-medium
    ${lgJustifyStart}
    transition-all
    text-sidebar-foreground
    hover:bg-sidebar-accent
  `;

  const itemActive = `
    bg-sidebar-primary
    text-sidebar-primary-foreground
  `;

  return (
    <aside className={`hidden md:flex fixed left-0 top-0 z-40 h-screen flex-col ${asideWidth} border-r border-sidebar-border bg-sidebar transition-[width] duration-200`}>
      {/* BOLINHA COLLAPSE/EXPAND — flutua na borda direita */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 z-50 h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar shadow-sm text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent hover:border-sidebar-accent transition-all"
        title={collapsed ? "Expandir menu" : "Recolher menu"}
        aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
      >
        <ChevronLeft className={`h-3.5 w-3.5 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`} />
      </button>

      {/* Toast in-app (clicável) para novas mensagens */}
      {/* HEADER */}
      <div className={`flex h-16 items-center justify-between border-b border-sidebar-border ${lgPx6}`}>
        <div className="flex items-center gap-2">
          {/* Mark sempre visível (cabe no sidebar colapsado de 64px). */}
          <BrandLogo variant="mark" size={1.75} />
          {/* Wordmark só quando expandido (some no mobile e no collapsed). */}
          <span className={lgShowInline}>
            <BrandLogo variant="wordmark" size={1.75} />
          </span>
          {isAdmin && (
            <Badge className={`${lgShowIFlex} gap-1`}>
              <ShieldCheck className="h-3 w-3" />
              Admin
            </Badge>
          )}
          {isGerente && !isAdmin && (
            <Badge variant="outline" className={`${lgShowIFlex} gap-1 border-amber-400 text-amber-600 dark:text-amber-400`}>
              <ShieldCheck className="h-3 w-3" />
              Gerente
            </Badge>
          )}
        </div>
        <div className={lgShowFlex}>
          <ThemeSwitcher />
        </div>
      </div>

      <div className={`${lgHide} justify-center py-2`}>
        <ThemeSwitcher />
      </div>

      {/* NAV */}
      {/* Em telas baixas (ex.: 768px), permite rolagem sem "quebrar" o layout */}
      <nav className="flex-1 overflow-y-auto space-y-1 py-3 px-2 lg:px-3">
        {filteredNavigation.map((item) => {
          const Icon = item.icon;
          const blocked = isOnboarding && !isPathAllowed(item.href);
          const isHighlighted = isOnboarding && item.href === allowedPath;

          if (blocked) {
            return (
              <div
                key={item.name}
                title={item.name}
                className={`${itemBase} opacity-30 cursor-not-allowed pointer-events-none`}
              >
                <Icon className="h-5 w-5" />
                <span className={lgShowInline}>{item.name}</span>
              </div>
            );
          }

          if (item.isChat) {
            return (
              <NavLink
                key={item.name}
                to={item.href}
                title={item.name}
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/chat", { state: { resetChat: true } });
                }}
                className={`${itemBase} ${isHighlighted ? "ring-2 ring-primary ring-offset-1 ring-offset-sidebar" : ""}`}
                activeClassName={itemActive}
              >
                <div className="relative">
                  <Icon className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <span className={lgShowInline}>{item.name}</span>
              </NavLink>
            );
          }

          return (
            <NavLink
              key={item.name}
              to={item.href}
              title={item.name}
              className={`${itemBase} ${isHighlighted ? "ring-2 ring-primary ring-offset-1 ring-offset-sidebar" : ""}`}
              activeClassName={itemActive}
            >
              <Icon className="h-5 w-5" />
              <span className={lgShowInline}>{item.name}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* FOOTER */}
      <div className="relative p-2 lg:p-3">
        {/* NOTIFICAÇÕES (Sininho) */}
<button onClick={() => setShowNotifications((v) => !v)} title="Notificações" className={itemBase}>
  <div className="relative">
    <Bell className="h-5 w-5" />
    {totalBellUnread > 0 && (
      <span className="absolute -top-1 -right-1 h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
        {totalBellUnread}
      </span>
    )}
  </div>
  <span className={lgShowInline}>Notificações</span>
</button>

{showNotifications && (
  <div
    data-notification-panel
    className="
      absolute
      right-[-320px]
      bottom-24
      w-80
      rounded-lg
      border border-border
      bg-background
      shadow-lg
      z-50
      overflow-hidden
    "
  >
    <div className="flex items-center justify-between p-3 border-b">
      <div className="text-sm font-medium">Central</div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setSoundMuted((v) => !v)}
          className="p-1 rounded hover:bg-muted"
          aria-label={soundMuted ? "Ativar som" : "Silenciar som"}
          title={soundMuted ? "Ativar som" : "Silenciar som"}
        >
          {soundMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>


        <button
          onClick={() => setShowNotifications(false)}
          className="p-1 rounded hover:bg-muted"
          aria-label="Fechar"
          title="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>

    {/* Tabs */}
    <div className="flex gap-1 p-2 border-b bg-muted/30">
      <button
        className={`flex-1 text-xs px-2 py-2 rounded ${
          panelTab === "messages" ? "bg-background border" : "hover:bg-muted"
        }`}
        onClick={() => setPanelTab("messages")}
      >
        Mensagens {msgUnreadCount > 0 ? `(${msgUnreadCount})` : ""}
      </button>
    <button
        className={`flex-1 text-xs px-2 py-2 rounded ${
          panelTab === "notifications" ? "bg-background border" : "hover:bg-muted"
        }`}
        onClick={() => setPanelTab("notifications")}
      >
        Sistema {sysUnreadCount > 0 ? `(${sysUnreadCount})` : ""}
      </button>
      </div>

    {/* Content */}
    <div className="max-h-80 overflow-auto">
      {panelTab === "notifications" ? (
        sysNotifs.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Nenhuma notificação</div>
        ) : (
          <div className="divide-y">
            {sysNotifs.map((n: any) => {
              const unread = (n.read ?? false) === false;
              const remoteJid = n?.meta?.remote_jid || n?.meta?.remoteJid || "";
                  const taskId = n?.meta?.task_id || n?.meta?.taskId || "";
              return (
                <button
                  key={n.id}
                  onClick={async () => {
                    if (taskId) openAgenda(taskId);
                  else if (remoteJid) openChat(remoteJid);
                  if (unread) {
                      await supabase
                        .from("notifications")
                        .update({ read: true })
                        .eq("id", n.id)
                        .eq("company_id", companyId)
                        .eq("user_id", user?.id);
                      await loadSysNotifications();
                    }
                  }}
                  className="w-full text-left p-3 hover:bg-muted/50"
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-1">
                      {renderSysNotifIcon(n.type)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className={`text-sm ${unread ? "font-medium" : "text-muted-foreground"}`}>
                          {n.title}
                        </div>
                        {unread && <span className="h-2 w-2 rounded-full bg-primary" />}
                      </div>
                      {n.body && <div className="text-xs text-muted-foreground line-clamp-2">{n.body}</div>}
                      <div className="text-[11px] text-muted-foreground mt-1">{formatDate(n.created_at)}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : msgNotifs.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">Nenhuma mensagem não lida</div>
      ) : (
        <div className="divide-y">
          {msgNotifs.map((m: any) => (
            <button
              key={m.id}
              onClick={async () => {
                openChat(m.remote_jid);
                await markLeadMessagesAsRead(m.remote_jid);
              }}
              className="w-full text-left p-3 hover:bg-muted/50"
            >
              <div className="flex items-start gap-2">
                <div className="mt-1">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground line-clamp-1">{(m.remote_jid?.split("@")[0]) || m.remote_jid}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">{formatConversationPreview(m)}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">{formatDate(m.created_at)}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>

    {/* Actions */}
    <div className="p-2 border-t bg-background flex items-center justify-between gap-2">
      {panelTab === "notifications" ? (
        <>
          <button
            onClick={markAllSysAsRead}
            className="flex-1 text-xs px-2 py-2 rounded border hover:bg-muted disabled:opacity-50"
            disabled={sysUnreadCount === 0}
          >
            Marcar tudo lido
          </button>
          <button
            onClick={clearReadSysNotifications}
            className="text-xs px-2 py-2 rounded border hover:bg-muted"
            title="Apagar notificações lidas"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={deleteAllSysNotifications}
            className="text-xs px-2 py-2 rounded border hover:bg-muted"
            title="Apagar todas"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      ) : (
        <>
          <button
            onClick={markAllMessagesAsRead}
            className="flex-1 text-xs px-2 py-2 rounded border hover:bg-muted disabled:opacity-50"
            disabled={msgUnreadCount === 0}
          >
            Marcar tudo lido
          </button>
          <button
            onClick={() => navigate("/notificacoes")}
            className="text-xs px-2 py-2 rounded border hover:bg-muted"
            title="Ver central"
          >
            Ver
          </button>
        </>
      )}
    </div>
  </div>
)}

        {/* SEPARADOR */}
        <div className="my-3 h-px bg-sidebar-border" />

        {/* SAIR */}
        <button
          onClick={logout}
          title="Sair"
          className={`
            flex items-center gap-3
            rounded-lg
            py-2.5
            ${lgPx3}
            text-sm font-medium
            ${lgJustifyStart}
            text-sidebar-foreground
            hover:bg-red-500/10 hover:text-red-500
            transition-all
          `}
        >
          <LogOut className="h-5 w-5" />
          <span className={lgShowInline}>Sair</span>
        </button>
      </div>

      {/* 🌐 WebView Modal (ex.: TikTok) */}
      {webViewOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setWebViewOpen(false)}
          />
          <div className="relative w-[95vw] max-w-5xl h-[85vh] rounded-xl overflow-hidden border bg-background shadow-2xl">
            <div className="flex items-center justify-between gap-2 p-3 border-b bg-muted/20">
              <div className="text-sm font-medium truncate">TikTok</div>
              <div className="flex items-center gap-2">
                <a
                  href={webViewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs px-2 py-1 rounded border hover:bg-muted"
                  title="Abrir em nova guia"
                >
                  Abrir em nova guia
                </a>
                <button
                  onClick={() => setWebViewOpen(false)}
                  className="p-1 rounded hover:bg-muted"
                  aria-label="Fechar"
                  title="Fechar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* OBS: Alguns sites (incluindo TikTok) podem bloquear iframe por segurança. */}
            <iframe
              src={webViewUrl}
              className="w-full h-[calc(85vh-52px)]"
              referrerPolicy="no-referrer"
              allow="clipboard-read; clipboard-write; autoplay; encrypted-media; fullscreen; picture-in-picture"
            />
          </div>
        </div>
      )}

    </aside>
  );
}