import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition mb-6">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>

        <h1 className="text-3xl font-bold tracking-tight">Política de Privacidade — Delvor</h1>
        <p className="mt-2 text-sm text-muted-foreground">Última atualização: 06/02/2026</p>

        <div className="prose prose-slate dark:prose-invert mt-8 max-w-none prose-headings:mt-8 prose-headings:mb-2 prose-p:leading-relaxed prose-p:text-foreground/90 prose-li:text-foreground/90">
          <h2>1. Introdução</h2>
          <p>
            A Delvor respeita a privacidade e a proteção de dados pessoais. Esta Política descreve como os dados
            são coletados, usados, armazenados e protegidos no uso da plataforma.
          </p>

          <h2>2. Papéis na LGPD</h2>
          <p>
            Para fins da LGPD, a Delvor atua como <strong>Operadora</strong> e o usuário/cliente como{" "}
            <strong>Controlador</strong> dos dados inseridos no sistema.
          </p>

          <h2>3. Dados Tratados</h2>
          <ul>
            <li>Dados do usuário: nome, e-mail, telefone, autenticação, plano/assinatura e faturamento.</li>
            <li>
              Dados de terceiros inseridos pelo usuário: clientes/contatos, mensagens, histórico de conversas, áudios
              e mídias, ordens de serviço e equipamentos.
            </li>
          </ul>

          <h2>4. Finalidades</h2>
          <p>
            Os dados são tratados para operar a plataforma, gerenciar contas, planos e permissões, entregar
            funcionalidades, manter segurança e cumprir obrigações legais. A Delvor não vende dados pessoais.
          </p>

          <h2>5. Bases legais</h2>
          <p>
            O tratamento pode ocorrer com base em execução de contrato, obrigação legal, legítimo interesse
            (segurança) e consentimento quando aplicável. O usuário controlador é responsável por assegurar base
            legal para dados de terceiros.
          </p>

          <h2>6. Compartilhamento</h2>
          <p>
            Pode haver compartilhamento com provedores de infraestrutura essenciais e serviços integrados pelo
            próprio usuário, além de ordens legais/judiciais.
          </p>

          <h2>7. Segurança</h2>
          <p>
            A Delvor adota medidas de segurança compatíveis com padrões de mercado. Nenhum sistema é 100% seguro.
          </p>

          <h2>8. Retenção e Exclusão</h2>
          <p>
            Os dados permanecem armazenados enquanto necessários para prestação do serviço ou conforme exigências
            legais.
          </p>

          <h2>9. Direitos dos titulares</h2>
          <p>
            Solicitações de titulares devem ser direcionadas ao Controlador (usuário da plataforma). A Delvor
            auxilia o controlador quando tecnicamente aplicável e solicitado.
          </p>

          <h2>10. Atualizações</h2>
          <p>
            Esta Política pode ser modificada a qualquer momento. A versão vigente será disponibilizada na
            plataforma.
          </p>
        </div>
      </div>
    </div>
  );
}
