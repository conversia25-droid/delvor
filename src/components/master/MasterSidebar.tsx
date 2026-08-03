import { LayoutDashboard, Megaphone, LogOut, ShieldCheck, LifeBuoy, Link2, CreditCard, MessageSquare, Mail } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const items = [
  { name: "Visão Geral", href: "/master", icon: LayoutDashboard },
  { name: "Comunicados", href: "/master/comunicados", icon: Megaphone },
  { name: "Suporte", href: "/master/suporte", icon: LifeBuoy },
  { name: "Afiliados", href: "/master/afiliados", icon: Link2 },
  { name: "Asaas", href: "/master/asaas", icon: CreditCard },
  { name: "YCloud", href: "/master/ycloud", icon: MessageSquare },
  { name: "Email", href: "/master/email", icon: Mail },
];

export default function MasterSidebar() {
  const { logout, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-16 lg:w-72 border-r border-slate-800 bg-slate-950 text-slate-100">
      <div className="flex h-full flex-col">
        <div className="border-b border-slate-800 px-3 py-4 lg:px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-blue-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="hidden lg:block min-w-0">
              <p className="text-sm font-semibold">Painel Master</p>
              <p className="truncate text-xs text-slate-400">{user?.email || "super admin"}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-2 py-4 lg:px-3">
          {items.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors",
                  active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-900 hover:text-white"
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="hidden lg:inline">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-2 lg:p-3">
          <button
            onClick={async () => {
              await logout();
              navigate("/master/login", { replace: true });
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-300 transition-colors hover:bg-slate-900 hover:text-white"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            <span className="hidden lg:inline">Sair</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
