import { useEffect, useState } from "react";
import { Home, Users, MessageSquare, Settings, Wrench, Wallet, Building2, Package, LogOut } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { supabase } from "@/integrations/supabase/client";

const items = [
  { name: "Início",    href: "/dashboard",       icon: Home },
  { name: "Clientes",  href: "/customers",       icon: Building2 },
  { name: "OS",        href: "/service-orders",  icon: Wrench },
  { name: "PDV",       href: "/pdv",             icon: Wallet },
  { name: "Estoque",   href: "/products",        icon: Package },
  { name: "Chat",      href: "/chat",            icon: MessageSquare },
  { name: "Config",    href: "/settings",        icon: Settings },
];

export default function MobileBottomNav() {
  const { user, isManager, hasRole, logout } = useAuth();
  const { isOnboarding, isPathAllowed, allowedPath } = useOnboarding();
  const isAdmin = hasRole("admin");
  const companyId = user?.company_id;
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!companyId) return;

    async function fetchUnread() {
      let query = supabase
        .from("wpp_conversations")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("from_me", false)
        .is("read_at", null);

      // Usuário comum: só conta não lidas dos leads atribuídos a ele
      if (!isAdmin && !isManager) {
        query = query.eq("assigned_user_id", user?.id);
      }

      const { count, error } = await query;
      if (!error && count != null) setUnreadCount(count);
    }

    fetchUnread();

    const channel = supabase
      .channel(`mobile-unread-${companyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wpp_conversations", filter: `company_id=eq.${companyId}` } as any,
        () => fetchUnread()
      )
      .subscribe();

    const interval = setInterval(fetchUnread, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [companyId]);

  const visible = items.filter((item) => {
    if (item.href === "/settings") return isAdmin;
    if (item.href === "/funnels") return isManager;
    if (item.href === "/templates") return isManager;
    return true;
  });

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-sidebar flex items-center justify-around h-14 px-2">
      {visible.map((item) => {
        const blocked = isOnboarding && !isPathAllowed(item.href);

        if (blocked) {
          return (
            <div
              key={item.href}
              className="relative flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] font-medium opacity-30 cursor-not-allowed"
            >
              <item.icon className="h-5 w-5" />
              <span>{item.name}</span>
            </div>
          );
        }

        return (
          <NavLink
            key={item.href}
            to={item.href}
            className={({ isActive }) =>
              `relative flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors text-[10px] font-medium ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              } ${isOnboarding && item.href === allowedPath ? "ring-2 ring-primary ring-offset-1 rounded-lg" : ""}`
            }
          >
            <div className="relative">
              <item.icon className="h-5 w-5" />
              {item.href === "/chat" && unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none shadow-sm">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </div>
            <span>{item.name}</span>
          </NavLink>
        );
      })}

        <button
          onClick={logout}
          className="relative flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] font-medium text-muted-foreground hover:text-red-500 transition-colors"
        >
          <LogOut className="h-5 w-5" />
          <span>Sair</span>
        </button>
    </nav>
  );
}
