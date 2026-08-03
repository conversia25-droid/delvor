import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function TermsOfUse() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition mb-6">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>

        <h1 className="text-3xl font-bold tracking-tight">Termos de Uso — Delvor</h1>
        <p className="mt-2 text-sm text-muted-foreground">Última atualização: 06/02/2026</p>

        <div className="prose prose-slate dark:prose-invert mt-8 max-w-none prose-headings:mt-8 prose-headings:mb-2 prose-p:leading-relaxed prose-p:text-foreground/90">
          <h2>1. Aceitação dos Termos</h2>
          <p>
            Ao acessar, utilizar ou contratar a plataforma <strong>Delvor</strong>, o usuário declara que leu,
            compreendeu e concorda integralmente com estes Termos de Uso. Caso não concorde, deve interromper
            imediatamente o uso.
          </p>

          <h2>2. Descrição da Plataforma</h2>
          <p>
            A Delvor é uma plataforma tecnológica (modelo <strong>SaaS</strong>) que oferece recursos para gestão
            de conversas e atendimentos, organização de leads e contatos, envio/recebimento de mensagens e mídias (texto,
            áudio, imagens e arquivos), gravação e reprodução de áudios, gerenciamento de usuários e permissões e
            visualização de histórico e atualizações em tempo real.
          </p>
          <p>
            A Delvor atua exclusivamente como ferramenta tecnológica, não controlando o conteúdo das comunicações
            realizadas pelos usuários.
          </p>

          <h2>3. Cadastro, Conta e Segurança</h2>
          <p>
            O usuário é responsável por fornecer dados corretos e atualizados, manter a confidencialidade de suas
            credenciais e por toda atividade executada em sua conta.
          </p>

          <h2>4. Planos, Contratação e Pagamentos</h2>
          <p>
            A Delvor é comercializada em planos com diferentes limites e funcionalidades. As condições
            (recursos, limites, preços e periodicidade) são aquelas exibidas na plataforma no momento da
            contratação/renovação. O não pagamento poderá ocasionar suspensão do acesso e eventual encerramento da conta,
            conforme regras comerciais vigentes.
          </p>

          <h2>5. Alteração de Plano</h2>
          <p>
            O usuário pode realizar upgrade ou downgrade, de acordo com as regras comerciais vigentes na plataforma.
          </p>

          <h2>6. Uso de WhatsApp e Serviços de Terceiros</h2>
          <p>
            A Delvor não possui vínculo com WhatsApp/Meta ou quaisquer serviços de terceiros integrados. O usuário
            deve cumprir os termos e políticas desses serviços. Bloqueios, restrições ou suspensões aplicadas por
            terceiros não geram responsabilidade para a Delvor.
          </p>

          <h2>7. Conteúdo e Responsabilidade</h2>
          <p>
            O usuário é o único responsável pelo conteúdo enviado/recebido/armazenado e por garantir a legalidade das
            comunicações e bases legais/consentimentos necessários, quando aplicável.
          </p>

          <h2>8. LGPD e Proteção de Dados</h2>
          <p>
            Para fins da LGPD, a Delvor atua como <strong>Operadora</strong> e o usuário contratante como{" "}
            <strong>Controlador</strong>, cabendo ao usuário definir finalidade e base legal para dados inseridos.
          </p>

          <h2>9. Disponibilidade, Manutenção e Atualizações</h2>
          <p>
            A plataforma é fornecida "no estado em que se encontra", podendo passar por atualizações e manutenções.
            Não há garantia de disponibilidade ininterrupta.
          </p>

          <h2>10. Suspensão e Encerramento</h2>
          <p>
            A Delvor poderá suspender ou encerrar contas em casos de uso ilícito, violação destes Termos,
            violação de políticas de terceiros, risco à segurança/estabilidade da plataforma ou determinação
            legal/judicial.
          </p>

          <h2>11. Propriedade Intelectual</h2>
          <p>
            O sistema, marca e demais elementos da Delvor são protegidos por direitos de propriedade intelectual.
            O usuário recebe licença de uso não exclusiva, intransferível e revogável, limitada à vigência do plano.
          </p>

          <h2>12. Limitação de Responsabilidade</h2>
          <p>
            A Delvor não se responsabiliza por resultados comerciais do usuário, bloqueios em serviços de
            terceiros, danos indiretos, conteúdo trafegado/armazenado pelo usuário ou falhas externas fora do controle
            razoável da plataforma.
          </p>

          <h2>13. Alterações</h2>
          <p>
            Estes Termos podem ser atualizados a qualquer momento. O uso continuado após alterações implica concordância
            com o texto vigente.
          </p>

          <h2>14. Lei Aplicável e Foro</h2>
          <p>
            Estes Termos são regidos pelas leis do Brasil. Fica eleito o foro da comarca do titular da Delvor.
          </p>
        </div>
      </div>
    </div>
  );
}
