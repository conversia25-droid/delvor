import { Link } from "react-router-dom";
import { Megaphone, ShieldCheck, Building2, LifeBuoy, CreditCard } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function MasterDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-blue-300">Painel Master</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Administração global do produto</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Ambiente separado do CRM para comunicar incidentes, manutenções e avisos gerais para todas as empresas.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-blue-300" /> Ambiente isolado</CardTitle>
            <CardDescription className="text-slate-400">Sem misturar o CRM operacional com o controle global.</CardDescription>
          </CardHeader>
        </Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Megaphone className="h-4 w-4 text-blue-300" /> Comunicados únicos</CardTitle>
            <CardDescription className="text-slate-400">Publique uma vez e entregue para todas as empresas.</CardDescription>
          </CardHeader>
        </Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-blue-300" /> Segmentação por empresa</CardTitle>
            <CardDescription className="text-slate-400">Comunicados podem ser globais ou enviados apenas para empresas selecionadas.</CardDescription>
          </CardHeader>
        </Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><LifeBuoy className="h-4 w-4 text-blue-300" /> Suporte centralizado</CardTitle>
            <CardDescription className="text-slate-400">Receba chamados das empresas e responda no painel master.</CardDescription>
          </CardHeader>
        </Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4 text-blue-300" /> Billing governado</CardTitle>
            <CardDescription className="text-slate-400">Plano, vencimento e inadimplência controlados no master.</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle>Comunicados do sistema</CardTitle>
            <CardDescription className="text-slate-400">Crie avisos em banner, popup e defina quais empresas devem receber.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/master/comunicados">Abrir comunicados</Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle>Empresas</CardTitle>
            <CardDescription className="text-slate-400">Abra cada conta e gerencie plano, status e limites.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary">
              <Link to="/master/empresas">Abrir empresas</Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle>Financeiro</CardTitle>
            <CardDescription className="text-slate-400">Veja faturas, cobrança e histórico financeiro.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary">
              <Link to="/master/billing">Abrir billing</Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle>Caixa de suporte</CardTitle>
            <CardDescription className="text-slate-400">Acompanhe os chamados das empresas e responda em tempo real.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary">
              <Link to="/master/suporte">Abrir suporte</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
