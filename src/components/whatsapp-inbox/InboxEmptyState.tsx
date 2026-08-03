import { WhatsAppLogo } from './InboxShared';

export function InboxEmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6 text-center">
      <div className="h-20 w-20 bg-muted rounded-full flex items-center justify-center mb-4">
        <WhatsAppLogo className="h-10 w-10 text-primary/50" />
      </div>
      <p className="text-xl font-medium mb-2">Selecione uma conversa</p>
      <p className="max-w-md text-sm">Escolha um lead na barra lateral para ver o histórico e enviar novas mensagens.</p>
    </div>
  );
}
