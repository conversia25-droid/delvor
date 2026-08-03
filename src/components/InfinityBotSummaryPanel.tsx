/**
 * Stub do InfinityBotSummaryPanel — substituído por placeholder neutro.
 *
 * O componente original integrava com um webhook n8n para gerar resumo
 * de conversa via IA. No Delvor esse fluxo foi removido; mantemos
 * só o `loadSummaryPrompt` retornando null para que o `WhatsAppInbox`
 * (que usa import dinâmico) compile e siga sem o resumo.
 */

/** Retorna null — sem prompt customizado. */
export async function loadSummaryPrompt(_companyId: string | null): Promise<string | null> {
  return null;
}

/** Componente vazio caso algum lugar ainda renderize. */
export default function InfinityBotSummaryPanel() {
  return null;
}
