import { useNavigate, useSearchParams } from "react-router-dom";
import { Settings as SettingsIcon, User, Building2, Palette, Lock, MessageSquare, CreditCard } from "lucide-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";

import ProfileSettings from "@/components/settings/ProfileSettings";
import CompanySettings from "@/components/settings/CompanySettings";
import AppearanceSettings from "@/components/settings/AppearanceSettings";
import WhatsAppSettings from "@/components/settings/WhatsAppSettings";
import BillingSettings from "@/components/settings/BillingSettings";

type Tab = "profile" | "company" | "billing" | "whatsapp" | "appearance";

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const perms = usePermissions();

  const requested = (searchParams.get("tab") as Tab) || "profile";
  // Abas restritas a admin/gerente
  const isAdminOrManager = perms.isAdmin || perms.isManager;
  const requiresElevation: Tab[] = ["company", "billing", "whatsapp"];
  const tab: Tab =
    requiresElevation.includes(requested) && !isAdminOrManager ? "profile" : requested;

  function setTab(t: Tab) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", t);
    navigate({ pathname: "/settings", search: next.toString() }, { replace: true });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight flex items-center gap-2">
          <SettingsIcon className="h-5 w-5 text-primary" /> Configurações
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Seu perfil, dados da empresa, WhatsApp e preferências.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v: any) => setTab(v)}>
        <TabsList>
          <TabsTrigger value="profile">
            <User className="h-3.5 w-3.5 mr-1" /> Meu perfil
          </TabsTrigger>

          {perms.isAdmin ? (
            <TabsTrigger value="company">
              <Building2 className="h-3.5 w-3.5 mr-1" /> Empresa
            </TabsTrigger>
          ) : (
            <TabsTrigger value="company" disabled title="Apenas admin">
              <Lock className="h-3.5 w-3.5 mr-1" /> Empresa
            </TabsTrigger>
          )}

          {perms.isAdmin ? (
            <TabsTrigger value="billing">
              <CreditCard className="h-3.5 w-3.5 mr-1" /> Cobrança
            </TabsTrigger>
          ) : (
            <TabsTrigger value="billing" disabled title="Apenas admin">
              <Lock className="h-3.5 w-3.5 mr-1" /> Cobrança
            </TabsTrigger>
          )}

          {isAdminOrManager ? (
            <TabsTrigger value="whatsapp">
              <MessageSquare className="h-3.5 w-3.5 mr-1" /> WhatsApp
            </TabsTrigger>
          ) : (
            <TabsTrigger value="whatsapp" disabled title="Apenas admin/gerente">
              <Lock className="h-3.5 w-3.5 mr-1" /> WhatsApp
            </TabsTrigger>
          )}

          <TabsTrigger value="appearance">
            <Palette className="h-3.5 w-3.5 mr-1" /> Aparência
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <ProfileSettings />
        </TabsContent>

        <TabsContent value="company" className="mt-6">
          {perms.isAdmin ? (
            <CompanySettings />
          ) : (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300 max-w-xl">
              <Lock className="h-4 w-4 inline mr-1" />
              Só administradores podem editar dados da empresa. Fale com o admin se precisar de alguma alteração.
            </div>
          )}
        </TabsContent>

        <TabsContent value="billing" className="mt-6">
          {perms.isAdmin ? (
            <BillingSettings />
          ) : (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300 max-w-xl">
              <Lock className="h-4 w-4 inline mr-1" />
              Só administradores podem ver a cobrança da empresa.
            </div>
          )}
        </TabsContent>

        <TabsContent value="whatsapp" className="mt-6">
          {isAdminOrManager ? (
            <WhatsAppSettings />
          ) : (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300 max-w-xl">
              <Lock className="h-4 w-4 inline mr-1" />
              Só administradores e gerentes podem gerenciar a conexão do WhatsApp.
            </div>
          )}
        </TabsContent>

        <TabsContent value="appearance" className="mt-6">
          <AppearanceSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
