import { Link } from "react-router-dom";
import {
  Wrench,
  ShoppingCart,
  Package,
  MessageSquare,
  Users,
  BarChart3,
  Shield,
  ArrowRight,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import BrandLogo from "@/components/BrandLogo";

const FEATURES = [
  {
    icon: Wrench,
    title: "Ordens de Serviço",
    description:
      "Workflow técnico completo: aberta → diagnóstico → aguardando peça → execução → entrega. Timeline automática, anexos, PDF com assinatura.",
  },
  {
    icon: ShoppingCart,
    title: "Vendas e Orçamentos",
    description:
      "Orçamento → pedido → faturamento, com itens, formas de pagamento, geração de PDF e baixa automática no estoque.",
  },
  {
    icon: Package,
    title: "Estoque inteligente",
    description:
      "Cadastro completo, alerta de mínimo, importação de NF-e por XML e histórico detalhado de cada peça.",
  },
  {
    icon: MessageSquare,
    title: "WhatsApp integrado",
    description:
      "Atendimento via Evolution e API Cloud oficial. Notificação automática a cada mudança de status da OS.",
  },
  {
    icon: Users,
    title: "Multi-equipe e permissões",
    description:
      "Vendedores, técnicos e gerentes — cada um vê só o que precisa. Transferência de OS e venda com auditoria.",
  },
  {
    icon: BarChart3,
    title: "Dashboard que importa",
    description:
      "Faturamento por dia, OS por status, ranking de vendedores, top produtos, estoque crítico — tudo em uma tela.",
  },
];

const SEGMENTS = [
  "Assistência técnica de impressoras",
  "Vendas de suprimentos e periféricos",
  "Locação e contratos de outsourcing",
  "Suporte de TI e atendimento remoto",
];

export default function Index() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* Navbar */}
      <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur sticky top-0 z-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-24 flex items-center justify-between">
          <Link to="/" className="flex items-baseline gap-2 leading-none" aria-label="Delvor OS">
            <BrandLogo size={2.75} />
            <span className="text-sm sm:text-base font-semibold tracking-[0.25em] text-blue-300 uppercase relative -top-1">
              OS
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost">
              <Link to="/login">Entrar</Link>
            </Button>
            <Button asChild className="bg-blue-600 hover:bg-blue-700 text-white">
              <Link to="/login">Criar conta</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero — centralizado */}
      <section className="relative">
        {/* Glows decorativos */}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-blue-600/20 blur-3xl" />
          <div className="absolute top-1/3 left-[20%] h-64 w-64 rounded-full bg-blue-600/15 blur-3xl" />
          <div className="absolute top-1/4 right-[15%] h-72 w-72 rounded-full bg-rose-600/10 blur-3xl" />
        </div>

        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-20 lg:py-32 text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 ring-1 ring-blue-500/30 px-4 py-1.5 text-xs text-blue-300 mb-8">
            <Sparkles className="h-3 w-3" />
            CRM + ERP + WhatsApp para serviços de tecnologia
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05]">
            Toda sua operação <br />
            <span className="bg-gradient-to-r from-blue-400 via-blue-400 to-rose-400 bg-clip-text text-transparent">
              numa tela só.
            </span>
          </h1>

          <p className="mt-8 text-lg sm:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Do primeiro contato à entrega faturada — orçamento, estoque,
            atendimento WhatsApp e relatórios no mesmo lugar. Sem planilha,
            sem WhatsApp pessoal, sem perder OS no balcão.
          </p>

          <div className="mt-10 flex flex-wrap gap-3 justify-center">
            <Button asChild size="lg" className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30">
              <Link to="/login">
                Começar agora <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-blue-500/40 bg-transparent text-blue-100 hover:bg-blue-500/10 hover:text-white hover:border-blue-400">
              <a href="#features">Ver recursos</a>
            </Button>
          </div>

          <div className="mt-14 flex flex-wrap gap-x-8 gap-y-3 text-sm text-slate-400 justify-center">
            {SEGMENTS.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-white/10 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Tudo o que sua operação precisa
            </h2>
            <p className="mt-4 text-slate-400">
              Construído pra empresas que prestam serviço de tecnologia. Cada módulo
              conversa com o outro: a peça que sai da OS já baixa no estoque, o orçamento
              vira pedido com um clique, o cliente recebe atualização no WhatsApp.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-6xl mx-auto">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="rounded-xl border border-white/10 bg-white/[0.02] p-6 hover:border-blue-500/30 hover:bg-white/[0.04] transition"
                >
                  <div className="rounded-lg bg-blue-500/10 ring-1 ring-blue-500/30 p-2 w-fit">
                    <Icon className="h-5 w-5 text-blue-300" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm text-slate-400 leading-relaxed">{f.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="border-t border-white/10 py-24 relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-[700px] rounded-full bg-blue-600/15 blur-3xl" />
        </div>

        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
          <Shield className="h-12 w-12 mx-auto text-blue-400 mb-6" />
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">
            Comece em 5 minutos.
          </h2>
          <p className="mt-4 text-lg text-slate-400">
            Cadastre sua empresa, importe seus clientes, abra a primeira OS.
            Sem cartão de crédito, sem setup obrigatório.
          </p>
          <div className="mt-10">
            <Button asChild size="lg" className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30">
              <Link to="/login">
                Criar minha conta <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-sm text-slate-400 flex flex-wrap items-center justify-between gap-3">
          <div>© {new Date().getFullYear()} Delvor — Todos os direitos reservados.</div>
          <div className="flex gap-4">
            <Link to="/termos" className="hover:text-slate-200">Termos de Uso</Link>
            <Link to="/privacidade" className="hover:text-slate-200">Política de Privacidade</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
