/**
 * Shell do app mobile (PWA).
 *
 * - Top bar com logo + nome do usuário + menu (sair, alternar pra desktop).
 * - Body sem padding (cada tela define o seu).
 * - Pensado pra ser instalado na home screen do celular do técnico — daí o
 *   `safe-area` pra respeitar o notch no iOS e o `pb-safe` pra não esbarrar
 *   na barra do Android.
 */
import { useState } from "react";
import { Outlet, useNavigate, useLocation, Link, NavLink } from "react-router-dom";
import { LogOut, Monitor, Menu, X, Wrench, Sun, Moon, MessageCircle, Check, ClipboardList, Calendar, ShoppingCart } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const THEME_OPTIONS = [
  { value: "light" as const,    label: "Claro",    Icon: Sun,            iconCls: "text-amber-500" },
  { value: "dark" as const,     label: "Escuro",   Icon: Moon,           iconCls: "text-blue-700 dark:text-blue-400" },
  { value: "whatsapp" as const, label: "WhatsApp", Icon: MessageCircle,  iconCls: "text-emerald-500" },
];

export default function MobileLayout() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const perms = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Esconde a bottom nav em sub-páginas (detalhe da OS / editor de venda) —
  // padrão de mobile app onde o usuário "entrou" em algo.
  const isSubPage =
    /^\/m\/orders\/[^/]+$/.test(location.pathname) ||
    /^\/m\/sales\/[^/]+$/.test(location.pathname);

  // Tab "Vender" só aparece pra quem vende — não polui o app do técnico puro.
  const showSalesTab = perms.isVendedor || perms.isManager;

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  // Iniciais pro avatar — fallback se não tiver nome
  const initials = (user?.nome || user?.email || "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* TOP BAR — fixa no topo, respeita notch */}
      <header
        className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border/60"
        style={{ paddingTop: "env(safe-area-inset-top, 0)" }}
      >
        <div className="flex items-center justify-between px-3 h-14">
          <Link to="/m/orders" className="flex items-center gap-2 font-semibold">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
              <Wrench className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm">Delvor</span>
          </Link>

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10">
                <div className="h-8 w-8 rounded-full bg-blue-500/15 ring-1 ring-blue-500/30 flex items-center justify-center text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                  {initials}
                </div>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 p-0">
              <SheetHeader className="p-4 border-b">
                <SheetTitle className="text-left">
                  <div className="text-sm">{user?.nome || "Usuário"}</div>
                  <div className="text-xs font-normal text-muted-foreground">
                    {user?.email}
                  </div>
                </SheetTitle>
              </SheetHeader>
              <div className="p-2 space-y-1">
                {/* TEMA — usa o mesmo ThemeContext que salva em profiles.theme,
                    então a escolha aqui vale em qualquer dispositivo onde o
                    técnico logar (desktop ou mobile). */}
                <div className="px-2 pt-2 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Tema
                </div>
                {THEME_OPTIONS.map((opt) => {
                  const active = theme === opt.value;
                  return (
                    <Button
                      key={opt.value}
                      variant="ghost"
                      className={`w-full justify-start h-11 ${active ? "bg-accent" : ""}`}
                      onClick={() => setTheme(opt.value)}
                    >
                      <opt.Icon className={`h-4 w-4 mr-2 ${opt.iconCls}`} />
                      <span className="flex-1 text-left">{opt.label}</span>
                      {active && <Check className="h-4 w-4 text-blue-700 dark:text-blue-400" />}
                    </Button>
                  );
                })}

                <div className="h-px bg-border/60 my-2" />

                <Button
                  variant="ghost"
                  className="w-full justify-start h-12"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate("/dashboard");
                  }}
                >
                  <Monitor className="h-4 w-4 mr-2" /> Versão desktop
                </Button>
                <Button
                  variant="ghost"
                  className="w-full justify-start h-12 text-rose-700 dark:text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                  onClick={handleLogout}
                >
                  <LogOut className="h-4 w-4 mr-2" /> Sair
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* BODY — `pb-16` só quando a bottom nav está visível, pra reservar
          espaço. Em sub-páginas (detalhe da OS), nav some e o sticky bottom
          do detalhe assume o rodapé. */}
      <main
        className="flex-1 overflow-y-auto"
        style={{
          paddingBottom: isSubPage
            ? "env(safe-area-inset-bottom, 0)"
            : "calc(4rem + env(safe-area-inset-bottom, 0))",
        }}
      >
        <Outlet />
      </main>

      {/* BOTTOM NAV — tabs principais. Esconde em sub-páginas.
          A tab "Vender" só aparece pra quem é vendedor (técnico puro não vê). */}
      {!isSubPage && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur border-t border-border/60"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0)" }}
        >
          <div
            className={`grid max-w-2xl mx-auto ${showSalesTab ? "grid-cols-3" : "grid-cols-2"}`}
          >
            <NavLink
              to="/m/orders"
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 h-14 transition ${
                  isActive || location.pathname.startsWith("/m/orders")
                    ? "text-blue-700 dark:text-blue-400"
                    : "text-muted-foreground"
                }`
              }
              end={false}
            >
              <ClipboardList className="h-5 w-5" />
              <span className="text-[10px] font-medium">OSs</span>
            </NavLink>
            <NavLink
              to="/m/schedule"
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 h-14 transition ${
                  isActive ? "text-blue-700 dark:text-blue-400" : "text-muted-foreground"
                }`
              }
            >
              <Calendar className="h-5 w-5" />
              <span className="text-[10px] font-medium">Agenda</span>
            </NavLink>
            {showSalesTab && (
              <NavLink
                to="/m/sales"
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-0.5 h-14 transition ${
                    isActive || location.pathname.startsWith("/m/sales")
                      ? "text-blue-700 dark:text-blue-400"
                      : "text-muted-foreground"
                  }`
                }
                end={false}
              >
                <ShoppingCart className="h-5 w-5" />
                <span className="text-[10px] font-medium">Vender</span>
              </NavLink>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
