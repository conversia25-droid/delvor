export function renderQuotedMessage(msg: any) {
  if (!msg?.quoted) return null;

  return (
    <div className="text-xs opacity-70 border-l pl-2">
      {msg.quoted.text || "Mensagem"}
    </div>
  );
}

export function renderReactionBubble(reaction: string) {
  if (!reaction) return null;

  return (
    <span className="text-xs bg-muted px-1 rounded">
      {reaction}
    </span>
  );
}

export function WhatsAppLogo() {
  return (
    <div className="text-green-500 font-bold">
      WhatsApp
    </div>
  );
}

export function VoiceRecorderWaveform() {
  return (
    <div className="h-6 w-32 bg-muted rounded" />
  );
}
