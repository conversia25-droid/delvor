import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BookOpen,
  Bot,
  Cable,
  LayoutDashboard,
  LifeBuoy,
  MessageCircleHeart,
  MessagesSquare,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { SupportPanel } from "./Support";

const quickAreas = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Leads", icon: Users },
  { label: "Chat", icon: MessagesSquare },
  { label: "Integrações", icon: Cable },
  { label: "Configurações", icon: Settings },
];

export default function Help() {
  const [supportOpen, setSupportOpen] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-24">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="h-3.5 w-3.5" />
            Central de ajuda
          </Badge>
          <Badge variant="outline">Orientações do sistema</Badge>
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight">Ajuda</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Consulte as orientações principais do sistema. Quando precisar de atendimento, use o agente de suporte no canto inferior direito da tela.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <Card className="border-border/70 bg-gradient-to-br from-primary/5 via-background to-background shadow-[0_20px_70px_-35px_rgba(99,102,241,0.4)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <BookOpen className="h-5 w-5 text-primary" />
              Primeiros passos no sistema
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
              <p className="font-medium text-foreground">Fluxo recomendado</p>
              <ol className="mt-3 list-decimal space-y-2 pl-5">
                <li>Configure usuários, equipe e integrações principais.</li>
                <li>Organize leads, contatos, funis e responsáveis.</li>
                <li>Centralize o atendimento no chat e acompanhe os retornos.</li>
                <li>Use agenda, tarefas e relatórios para manter a operação previsível.</li>
              </ol>
            </div>

            <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
              <p className="font-medium text-foreground">Boas práticas</p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>Padronize nomes de leads, equipes e funis.</li>
                <li>Evite conversas sem responsável definido.</li>
                <li>Revise permissões e acessos com frequência.</li>
                <li>Use etapas realmente úteis para não poluir a operação.</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <LifeBuoy className="h-5 w-5 text-primary" />
              Áreas úteis do sistema
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Estes são alguns pontos do CRM que merecem atenção no uso do dia a dia.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {quickAreas.map((area) => {
                const Icon = area.icon;
                return (
                  <div
                    key={area.label}
                    className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/20 px-4 py-3"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{area.label}</p>
                      <p className="text-xs text-muted-foreground">Área estratégica do CRM</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
              Para falar com o suporte, clique no agente flutuante no canto inferior direito. O atendimento abre em formato de chat, sem misturar com o conteúdo da Ajuda.
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="fixed bottom-5 right-5 z-50 flex items-end gap-3">
        {!supportOpen ? (
          <div className="hidden max-w-[320px] rounded-2xl border border-border/70 bg-background/95 p-4 shadow-2xl backdrop-blur md:block">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageCircleHeart className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Agente de suporte</p>
                <p className="text-xs text-muted-foreground">Online agora</p>
              </div>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              Precisa de ajuda? Abra o atendimento aqui sem sair da página.
            </p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setSupportOpen((prev) => !prev)}
          className="group flex h-14 w-14 items-center justify-center rounded-full border border-primary/30 bg-primary text-primary-foreground shadow-[0_20px_40px_-20px_rgba(99,102,241,0.75)] transition hover:scale-105"
          aria-label={supportOpen ? "Fechar suporte" : "Abrir suporte"}
        >
          {supportOpen ? <X className="h-6 w-6 transition group-hover:scale-110" /> : <Bot className="h-6 w-6 transition group-hover:scale-110" />}
        </button>
      </div>

      {supportOpen ? (
        <div className="fixed bottom-24 right-5 z-50 h-[min(78vh,760px)] w-[min(420px,calc(100vw-1.5rem))] overflow-hidden rounded-[28px] border border-border/70 bg-background shadow-[0_30px_80px_-30px_rgba(0,0,0,0.65)]">
          <div className="flex items-center justify-between border-b border-border/70 bg-gradient-to-r from-primary/12 via-background to-background px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Suporte Delvor</p>
                <p className="text-xs text-muted-foreground">Atendimento dentro do CRM</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={() => setSupportOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="h-[calc(100%-65px)] overflow-auto p-4">
            <SupportPanel embedded />
          </div>
        </div>
      ) : null}
    </div>
  );
}
