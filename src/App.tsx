import {
  useEffect,
  useState,
  Suspense,
  lazy,
  useRef,
} from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { InactivityWarning } from "@/components/InactivityWarning";
import Sidebar from "@/components/Sidebar";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import { useTrialExpiryNotification } from "@/hooks/useTrialExpiryNotification";
import MobileBottomNav from "@/components/MobileBottomNav";
import FullPageLoader from "@/components/FullPageLoader";
import { supabase } from "@/integrations/supabase/client";
import { NotificationToast } from "@/components/NotificationToast";
import SystemAnnouncementBanner from "@/components/SystemAnnouncementBanner";
import SystemAnnouncementModal from "@/components/SystemAnnouncementModal";
import MasterSidebar from "@/components/master/MasterSidebar";
import { OnboardingProvider, useOnboarding } from "@/contexts/OnboardingContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import OnboardingOverlay from "@/components/OnboardingOverlay";
import TrialBanner from "@/components/TrialBanner";

/* =========================
   LAZY PAGES
========================= */
const LandingPage = lazy(() => import("./pages/Index"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Team = lazy(() => import("./pages/Team"));
const Chat = lazy(() => import("./pages/Chat"));
const PDV = lazy(() => import("./pages/PDV"));
const Reports = lazy(() => import("./pages/Reports"));
const Contacts = lazy(() => import("./pages/Contacts"));
const Settings = lazy(() => import("./pages/Settings"));
const Login = lazy(() => import("./pages/Login"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const UpdatePassword = lazy(() => import("./pages/UpdatePassword"));
const TermsOfUse = lazy(() => import("./pages/TermsOfUse"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TrackOrder = lazy(() => import("./pages/TrackOrder"));
const Help = lazy(() => import("./pages/Help"));
const Support = lazy(() => import("./pages/Support"));
const NotFound = lazy(() => import("./pages/NotFound"));
const FinanceiroCategorias = lazy(() => import("./pages/financeiro/Categorias"));
const FinanceiroFixas = lazy(() => import("./pages/financeiro/DespesasFixas"));
const FinanceiroVariaveis = lazy(() => import("./pages/financeiro/DespesasVariaveis"));
const FinanceiroPrecificacao = lazy(() => import("./pages/financeiro/Precificacao"));
const MasterLogin = lazy(() => import("./pages/master/MasterLogin"));
const MasterDashboard = lazy(() => import("./pages/master/MasterDashboard"));
const MasterAnnouncements = lazy(() => import("./pages/master/MasterAnnouncements"));
const MasterSupport = lazy(() => import("./pages/master/MasterSupport"));
const MasterCompanies = lazy(() => import("./pages/master/MasterCompanies"));
const MasterBilling = lazy(() => import("./pages/master/MasterBilling"));
const MasterBillingCompany = lazy(() => import("./pages/master/MasterBillingCompany"));
const MasterArchive = lazy(() => import("./pages/master/MasterArchive"));
const MasterAffiliates = lazy(() => import("./pages/master/MasterAffiliates"));
const MasterAsaas = lazy(() => import("./pages/master/MasterAsaas"));
const MasterYCloud = lazy(() => import("./pages/master/MasterYCloud"));
const MasterEmail = lazy(() => import("./pages/master/MasterEmail"));

// --- MÓDULOS Delvor ---
const Customers = lazy(() => import("./pages/Customers"));
const CustomerDetail = lazy(() => import("./pages/CustomerDetail"));
const Products = lazy(() => import("./pages/Products"));
const Services = lazy(() => import("./pages/Services"));
const Suppliers = lazy(() => import("./pages/Suppliers"));
const Sales = lazy(() => import("./pages/Sales"));
const Orcamentos = lazy(() => import("./pages/Orcamentos"));
const SaleEditor = lazy(() => import("./pages/SaleEditor"));
const ServiceOrders = lazy(() => import("./pages/ServiceOrders"));
const ServiceOrderEditor = lazy(() => import("./pages/ServiceOrderEditor"));
const Schedule = lazy(() => import("./pages/Schedule"));
const Purchases = lazy(() => import("./pages/Purchases"));
const PurchaseEditor = lazy(() => import("./pages/PurchaseEditor"));
const Rentals = lazy(() => import("./pages/Rentals"));
const RentalEditor = lazy(() => import("./pages/RentalEditor"));
const Placeholder = lazy(() => import("./pages/Placeholder"));
// PWA mobile — app do técnico (e vendedor, quando combinado)
const MobileLayout = lazy(() => import("./pages/mobile/MobileLayout"));
const MobileOrdersList = lazy(() => import("./pages/mobile/MobileOrdersList"));
const MobileOrderNew = lazy(() => import("./pages/mobile/MobileOrderNew"));
const MobileOrderDetail = lazy(() => import("./pages/mobile/MobileOrderDetail"));
const MobileSchedule = lazy(() => import("./pages/mobile/MobileSchedule"));
const MobileSalesList = lazy(() => import("./pages/mobile/MobileSalesList"));
const MobileSaleEditor = lazy(() => import("./pages/mobile/MobileSaleEditor"));

const queryClient = new QueryClient();

/* =========================
   LAYOUT PROTEGIDO (ORIGINAL)
========================= */
function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const layoutLocation = useLocation();
  const isChat = layoutLocation.pathname === "/chat";
  const isOsKanban = layoutLocation.pathname === "/service-orders";
  // Rotas que precisam ocupar a tela inteira (chat full-screen, kanban com muitas colunas).
  const isFullWidth = isChat || isOsKanban;
  const [sidebarCollapsed] = useSidebarCollapsed();
  // Reserva espaço pro painel lateral do onboarding (w-72 = 288px) — só quando
  // ele está visível em modo sidebar (não em modo modal fullscreen).
  const { isOnboarding, showModal } = useOnboarding();
  const onboardingSidebarVisible = isOnboarding && !showModal;
  useTrialExpiryNotification();
  return (
    <>
      <Sidebar />
      <MobileBottomNav />
      <TrialBanner />
      <main className={`md:ml-16 ${sidebarCollapsed ? "" : "lg:ml-64"} ${onboardingSidebarVisible ? "lg:mr-72" : ""} min-h-screen pb-14 md:pb-0 bg-background flex flex-col transition-[margin] duration-200`}>
        <div className="flex-1 w-full">
          <div className={`mx-auto w-full ${isFullWidth ? "" : "max-w-[1600px]"} p-4 sm:p-6 lg:p-8`}>
            <SystemAnnouncementBanner />
            <SystemAnnouncementModal />
            {children}
          </div>
        </div>

        <footer className="border-t bg-background/60">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4 text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2">
      <span>© {new Date().getFullYear()} Delvor</span>
      <span className="opacity-60">•</span>
      <Link to="/termos" className="hover:underline">Termos de Uso</Link>
      <span className="opacity-60">•</span>
      <Link to="/privacidade" className="hover:underline">Política de Privacidade</Link>
          </div>
        </footer>
</main>
      <OnboardingOverlay />
    </>
  );
}


function MasterProtectedLayout({ children }: { children: React.ReactNode }) {
  // O painel master é desenhado em tema escuro (bg-slate-950). Aplicamos .dark
  // num wrapper local — mexer em document.documentElement briga com o
  // ThemeContext, que reseta a classe pro tema salvo do usuário em todo
  // re-render, deixando botões outline com bg claro no fundo dark.
  return (
    <div className="dark">
      <MasterSidebar />
      <main className="ml-16 lg:ml-72 min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        <div className="flex-1 w-full">
          <div className="mx-auto w-full max-w-[1700px] p-4 sm:p-6 lg:p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

/* =========================
   ROOT REDIRECT
========================= */
function RootRedirect() {
  const { isAuthenticated, loading, hasRole } = useAuth();
  if (loading) return <FullPageLoader label="Carregando..." />;
  if (isAuthenticated) {
    if (hasRole("super_admin")) return <Navigate to="/master" replace />;
    // Só técnico PURO abre no mobile — quem também é vendedor/admin/gerente vai
    // pro desktop, mesmo tendo `tecnico` no perfil. Vendedor precisa das telas
    // de venda/estoque/relatório, que só existem no desktop.
    const isTec = hasRole("tecnico");
    const isManager = hasRole("admin") || hasRole("gerente");
    const isSeller = hasRole("vendedor") || hasRole("user");
    if (isTec && !isManager && !isSeller) return <Navigate to="/m/orders" replace />;
    return <Navigate to="/dashboard" replace />;
  }
  return <LandingPage />;
}

/* =========================
   CONTEÚDO DO APP
========================= */
function AppContent() {
  const { loading, user, hasRole } = useAuth();
  const companyId = user?.company_id;

  /* =========================
     CACHE DE LEADS
   ========================= */
  const [leadMap, setLeadMap] = useState<Map<string, string>>(new Map());

  /* =========================
     NOTIFICAÇÕES / ABA
   ========================= */
  const [unreadCount, setUnreadCount] = useState(0);
  const baseTitle = "Delvor";
  const blinkIntervalRef = useRef<number | null>(null);

  /* =========================
     ATUALIZA TÍTULO
   ========================= */
  useEffect(() => {
    document.title =
      unreadCount > 0 ? `(${unreadCount}) ${baseTitle}` : baseTitle;
  }, [unreadCount]);

  /* =========================
     FUNÇÃO DE PISCAR
   ========================= */
  const blinkTabTitle = (count: number) => {
    if (blinkIntervalRef.current) return;
    if (document.visibilityState === "visible") return;

    const alertTitle = `(${count}) ${baseTitle}`;
    let visible = false;
    let flashes = 0;

    blinkIntervalRef.current = window.setInterval(() => {
      document.title = visible ? baseTitle : alertTitle;
      visible = !visible;
      flashes++;

      if (flashes >= 6) {
        if (blinkIntervalRef.current) {
          clearInterval(blinkIntervalRef.current);
          blinkIntervalRef.current = null;
        }
        document.title = alertTitle;
      }
    }, 700);
  };

  /* =========================
     RESET AO FOCAR ABA
   ========================= */
  useEffect(() => {
    const reset = () => {
      setUnreadCount(0);
      document.title = baseTitle;

      if (blinkIntervalRef.current) {
        clearInterval(blinkIntervalRef.current);
        blinkIntervalRef.current = null;
      }
    };

    window.addEventListener("focus", reset);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reset();
    });

    return () => {
      window.removeEventListener("focus", reset);
    };
  }, []);

  /* =========================
     ALERTA SONORO DE TAREFAS
     - toca no toast (NotificationToast) quando:
       * há tarefas vencidas
       * há tarefas vencendo em até 24h
     - roda globalmente (não depende do usuário estar na tela Agenda/Dashboard)
   ========================= */
  const lastOverdueRef = useRef<number>(0);
  const lastDueSoonRef = useRef<number>(0);

  useEffect(() => {
    if (loading || !companyId || !user?.id) return;

    let cancelled = false;
    let timer: number | null = null;

    async function checkTasksAndNotify() {
      if (cancelled) return;
      try {
        const nowIso = new Date().toISOString();
        const untilIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        // base
        let baseOverdue = supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("done", false)
          .not("due_at", "is", null)
          .lt("due_at", nowIso);

        let baseDueSoon = supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("done", false)
          .not("due_at", "is", null)
          .gte("due_at", nowIso)
          .lte("due_at", untilIso);

        // 🔐 usuário comum: só as próprias
        if (!hasRole("admin")) {
          baseOverdue = baseOverdue.eq("assigned_to", user.id);
          baseDueSoon = baseDueSoon.eq("assigned_to", user.id);
        }

        const [overdueRes, dueSoonRes] = await Promise.all([baseOverdue, baseDueSoon]);
        if (cancelled) return;

        const overdueCount = overdueRes.count || 0;
        const dueSoonCount = dueSoonRes.count || 0;

        // Notifica apenas quando aumenta (evita spam a cada polling)
        if (overdueCount > lastOverdueRef.current) {
          window.dispatchEvent(
            new CustomEvent("crm-notification", {
              detail: {
                type: "task_overdue",
                title: `${overdueCount} tarefa(s) vencida(s)`,
                description: hasRole("admin")
                  ? "Existem tarefas vencidas no time. Verifique responsáveis e prazos."
                  : "Você tem tarefas vencidas. Priorize essas pendências.",
                action: { href: "/agenda" },
                meta: { href: "/agenda" },
              },
            })
          );
        }

        if (dueSoonCount > lastDueSoonRef.current) {
          window.dispatchEvent(
            new CustomEvent("crm-notification", {
              detail: {
                type: "task_due_soon",
                title: `${dueSoonCount} tarefa(s) vencendo em até 24h`,
                description: "Organize sua fila para cumprir os prazos.",
                action: { href: "/agenda" },
                meta: { href: "/agenda" },
              },
            })
          );
        }

        lastOverdueRef.current = overdueCount;
        lastDueSoonRef.current = dueSoonCount;
      } catch (err) {
        console.warn("Falha ao checar tarefas para alerta sonoro:", err);
      }
    }

    // roda ao iniciar e depois a cada 60s
    checkTasksAndNotify();
    timer = window.setInterval(checkTasksAndNotify, 60_000);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [loading, companyId, user?.id, hasRole]);

  /* =========================
     LOAD LEADS
   ========================= */
  useEffect(() => {
    supabase
      .from("leads")
      .select("remote_jid, lead_code, lead_name")
      .then(({ data }) => {
        if (!data) return;

        const map = new Map<string, string>();
        data.forEach((l: any) => {
          map.set(l.remote_jid, l.lead_name || l.lead_code || l.remote_jid);
        });

        setLeadMap(map);
      });
  }, []);

  /* =========================
     NOTIFICAÇÕES
     (Somente in-app / clicável)
   ========================= */

  /* =========================
     REALTIME SUPABASE (CHAT)
   ========================= */
  useEffect(() => {
    if (loading || !companyId) return;

    const channel = supabase
      .channel(`crm-notifications-${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "wpp_conversations",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const msg: any = payload.new;
          if (msg.from_me) return;

          // Filtrar notificações por papel:
          // - Admin/Gerente: recebe todas
          // - Usuário comum: só recebe do lead atribuído a ele
          const isAdminOrManager = hasRole("admin") || hasRole("gerente");
          if (!isAdminOrManager) {
            const assignedTo = msg.assigned_user_id;
            if (assignedTo && assignedTo !== user?.id) return;
          }

          const leadName = leadMap.get(msg.remote_jid) || msg.remote_jid;

          setUnreadCount((c) => {
            const next = c + 1;
            blinkTabTitle(next);
            return next;
          });

          window.dispatchEvent(
            new CustomEvent("crm-notification", {
              detail: {
                type: "chat",
                title: leadName,
                description: msg.message || "Nova mensagem",
                meta: {
                  remote_jid: msg.remote_jid,
                  assigned_user_id: msg.assigned_user_id,
                },
                action: {
                  href: `/chat?jid=${msg.remote_jid}`,
                },
              },
            })
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, leadMap, loading]);

  if (loading) {
    return <FullPageLoader label="Carregando sessão..." />;
  }

  return (
    <>
      <InactivityWarning />

      <Suspense fallback={<FullPageLoader />}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route path="/master/login" element={<MasterLogin />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/update-password" element={<UpdatePassword />} />
          <Route path="/termos" element={<TermsOfUse />} />
          <Route path="/privacidade" element={<PrivacyPolicy />} />
          <Route path="/acompanhar" element={<TrackOrder />} />
          <Route path="/ajuda" element={<ProtectedRoute><ProtectedLayout><Help /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/support" element={<ProtectedRoute><ProtectedLayout><Support /></ProtectedLayout></ProtectedRoute>} />

          <Route path="/dashboard" element={<ProtectedRoute><ProtectedLayout><Dashboard /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/chat" element={<ProtectedRoute><ProtectedLayout><Chat /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/pdv" element={<ProtectedRoute><ProtectedLayout><PDV /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute><ProtectedLayout><Reports /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/contacts" element={<ProtectedRoute><ProtectedLayout><Contacts /></ProtectedLayout></ProtectedRoute>} />

          {/* Rotas legadas do CRM original — redireciona pra Dashboard
              pra não quebrar bookmarks. As funcionalidades correspondentes
              foram absorvidas pelo Dashboard ou serão refeitas em fase futura. */}
          <Route path="/leads"             element={<Navigate to="/dashboard" replace />} />
          <Route path="/funnels"           element={<Navigate to="/dashboard" replace />} />
          <Route path="/notificacoes"      element={<Navigate to="/dashboard" replace />} />
          <Route path="/relatorios"        element={<Navigate to="/dashboard" replace />} />
          <Route path="/automations"       element={<Navigate to="/dashboard" replace />} />
          <Route path="/templates"         element={<Navigate to="/dashboard" replace />} />
          <Route path="/contacts"          element={<Navigate to="/customers" replace />} />
          <Route path="/tarefas"           element={<Navigate to="/dashboard" replace />} />
          <Route path="/evolution-logs"    element={<Navigate to="/dashboard" replace />} />
          <Route path="/tv"                element={<Navigate to="/dashboard" replace />} />
          <Route path="/tv/connect"        element={<Navigate to="/dashboard" replace />} />
          <Route path="/tv/wallboard"      element={<Navigate to="/dashboard" replace />} />

          <Route path="/team" element={<ProtectedRoute><ProtectedLayout><Team /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><ProtectedLayout><Settings /></ProtectedLayout></ProtectedRoute>} />
          {/* --- MÓDULOS Delvor --- */}
          <Route path="/customers" element={<ProtectedRoute><ProtectedLayout><Customers /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/customers/:id" element={<ProtectedRoute><ProtectedLayout><CustomerDetail /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/products" element={<ProtectedRoute><ProtectedLayout><Products /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/services" element={<ProtectedRoute><ProtectedLayout><Services /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/suppliers" element={<ProtectedRoute><ProtectedLayout><Suppliers /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/sales" element={<ProtectedRoute><ProtectedLayout><Sales /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/sales/new" element={<ProtectedRoute><ProtectedLayout><SaleEditor /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/sales/:id" element={<ProtectedRoute><ProtectedLayout><SaleEditor /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/orcamentos" element={<ProtectedRoute><ProtectedLayout><Orcamentos /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/orcamentos/new" element={<ProtectedRoute><ProtectedLayout><SaleEditor /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/service-orders" element={<ProtectedRoute><ProtectedLayout><ServiceOrders /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/service-orders/new" element={<ProtectedRoute><ProtectedLayout><ServiceOrderEditor /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/service-orders/:id" element={<ProtectedRoute><ProtectedLayout><ServiceOrderEditor /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/schedule" element={<ProtectedRoute><ProtectedLayout><Schedule /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/purchases" element={<ProtectedRoute><ProtectedLayout><Purchases /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/purchases/new" element={<ProtectedRoute><ProtectedLayout><PurchaseEditor /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/purchases/:id" element={<ProtectedRoute><ProtectedLayout><PurchaseEditor /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/rentals" element={<ProtectedRoute><ProtectedLayout><Rentals /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/rentals/new" element={<ProtectedRoute><ProtectedLayout><RentalEditor /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/rentals/:id" element={<ProtectedRoute><ProtectedLayout><RentalEditor /></ProtectedLayout></ProtectedRoute>} />
          {/* --- ADD-ON FINANCEIRO --- */}
          <Route path="/financeiro" element={<Navigate to="/financeiro/fixas" replace />} />
          <Route path="/financeiro/categorias" element={<ProtectedRoute><ProtectedLayout><FinanceiroCategorias /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/financeiro/fixas" element={<ProtectedRoute><ProtectedLayout><FinanceiroFixas /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/financeiro/variaveis" element={<ProtectedRoute><ProtectedLayout><FinanceiroVariaveis /></ProtectedLayout></ProtectedRoute>} />
          <Route path="/financeiro/precificacao" element={<ProtectedRoute><ProtectedLayout><FinanceiroPrecificacao /></ProtectedLayout></ProtectedRoute>} />

          {/* Redirect do /agenda legado pra /schedule */}
          <Route path="/agenda" element={<Navigate to="/schedule" replace />} />
          <Route path="/agenda/calendario" element={<Navigate to="/schedule" replace />} />

          {/* ═════ APP MOBILE (PWA) ═════
              Rotas /m/* usam o MobileLayout (top bar simples, sem sidebar
              desktop). Pensado pro técnico instalar no celular. */}
          <Route path="/m" element={<ProtectedRoute><MobileLayout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/m/orders" replace />} />
            <Route path="orders" element={<MobileOrdersList />} />
            <Route path="orders/new" element={<MobileOrderNew />} />
            <Route path="orders/:id" element={<MobileOrderDetail />} />
            <Route path="schedule" element={<MobileSchedule />} />
            <Route path="sales" element={<MobileSalesList />} />
            <Route path="sales/new" element={<MobileSaleEditor />} />
            <Route path="sales/:id" element={<MobileSaleEditor />} />
          </Route>

          <Route path="/master" element={<ProtectedRoute requireSuperAdmin><MasterProtectedLayout><MasterDashboard /></MasterProtectedLayout></ProtectedRoute>} />
          <Route path="/master/empresas" element={<ProtectedRoute requireSuperAdmin><MasterProtectedLayout><MasterCompanies /></MasterProtectedLayout></ProtectedRoute>} />
          <Route path="/master/empresas/:companyId" element={<ProtectedRoute requireSuperAdmin><MasterProtectedLayout><MasterBillingCompany /></MasterProtectedLayout></ProtectedRoute>} />
          <Route path="/master/empresas/:companyId/arquivo" element={<ProtectedRoute requireSuperAdmin><MasterProtectedLayout><MasterArchive /></MasterProtectedLayout></ProtectedRoute>} />
          <Route path="/master/billing" element={<ProtectedRoute requireSuperAdmin><MasterProtectedLayout><MasterBilling /></MasterProtectedLayout></ProtectedRoute>} />
          <Route path="/master/comunicados" element={<ProtectedRoute requireSuperAdmin><MasterProtectedLayout><MasterAnnouncements /></MasterProtectedLayout></ProtectedRoute>} />
          <Route path="/master/suporte" element={<ProtectedRoute requireSuperAdmin><MasterProtectedLayout><MasterSupport /></MasterProtectedLayout></ProtectedRoute>} />
          <Route path="/master/afiliados" element={<ProtectedRoute requireSuperAdmin><MasterProtectedLayout><MasterAffiliates /></MasterProtectedLayout></ProtectedRoute>} />
          <Route path="/master/asaas" element={<ProtectedRoute requireSuperAdmin><MasterProtectedLayout><MasterAsaas /></MasterProtectedLayout></ProtectedRoute>} />
          <Route path="/master/ycloud" element={<ProtectedRoute requireSuperAdmin><MasterProtectedLayout><MasterYCloud /></MasterProtectedLayout></ProtectedRoute>} />
          <Route path="/master/email" element={<ProtectedRoute requireSuperAdmin><MasterProtectedLayout><MasterEmail /></MasterProtectedLayout></ProtectedRoute>} />
          <Route path="/master/dashboard" element={<Navigate to="/master" replace />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>

      <NotificationToast />
    </>
  );
}

/* =========================
   APP ROOT
========================= */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <SubscriptionProvider>
                <OnboardingProvider>
                  <AppContent />
                </OnboardingProvider>
              </SubscriptionProvider>
            </BrowserRouter>
          </TooltipProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}