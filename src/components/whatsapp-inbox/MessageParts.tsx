export function WhatsAppLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
    </svg>
  );
}

export function MessageReactions({ msg }: { msg: any }) {
  const reactions = msg.reactions_data || [];
  if (reactions.length === 0) return null;

  return (
    <div className={`absolute -bottom-3 ${msg.from_me ? "right-2" : "left-2"} flex gap-1 z-20 animate-in zoom-in duration-200`}>
      <div className="flex items-center gap-1 bg-background border shadow-sm rounded-full px-2 py-0.5 scale-90 select-none">
        {reactions.map((r: any, i: number) => (
          <span key={i} className="text-[14px]">{r.emoji}</span>
        ))}
      </div>
    </div>
  );
}

export function RenderQuotedMessage({ msg, currentLeadName, resolveQuotedById }: any) {
  try {
    let payload = (msg as any)?.raw_payload;
    if (typeof payload === "string") {
      try {
        payload = payload.startsWith("{") ? JSON.parse(payload) : null;
      } catch (e) {
        payload = null;
      }
    }

    const contextInfo =
      payload?.message?.extendedTextMessage?.contextInfo ||
      payload?.message?.imageMessage?.contextInfo ||
      payload?.data?.message?.extendedTextMessage?.contextInfo ||
      payload?.contextInfo;

    const qid =
      (msg as any)?.context_quoted_message_id ||
      contextInfo?.stanzaId ||
      payload?.quoted_message_id ||
      null;

    if (!qid && !contextInfo?.quotedMessage) return null;

    let quotedBody = null;
    let quotedParticipant = null;

    if (qid) {
      const quotedMsg = resolveQuotedById(String(qid));
      if (quotedMsg) {
        const qType = String((quotedMsg as any)?.message_type || "text");
        const qText = String((quotedMsg as any)?.message || "").trim();
        quotedBody =
          qText ||
          (qType === "image" ? "📷 Imagem" : null) ||
          (qType === "video" ? "🎥 Vídeo" : null) ||
          (qType === "audio" ? "🎙️ Áudio" : null) ||
          (qType === "document" ? "📄 Documento" : "Anexo");
        quotedParticipant = quotedMsg.from_me ? "Você" : currentLeadName;
      }
    }

    if (!quotedBody && contextInfo?.quotedMessage) {
      quotedBody =
        contextInfo.quotedMessage.conversation ||
        contextInfo.quotedMessage.extendedTextMessage?.text ||
        (contextInfo.quotedMessage.imageMessage ? "📷 Imagem" : "Mensagem original...");

      quotedParticipant = contextInfo.participant ? currentLeadName : "Contato";
    }

    if (!quotedBody) quotedBody = "Respondendo...";

    return (
      <div className="mb-2 rounded-md border-l-4 border-primary/60 bg-white/10 p-2 text-sm shadow-sm select-none overflow-hidden max-w-full">
        <span className="line-clamp-1 block text-[11px] text-white/70 font-semibold mb-0.5 truncate">
          {quotedParticipant || "Mensagem original"}
        </span>
        <span className="line-clamp-2 block text-xs opacity-80 break-words whitespace-pre-wrap">
          {quotedBody}
        </span>
      </div>
    );
  } catch (err) {
    return null;
  }
}

export function RecordingWaveBars({ levels }: { levels: number[] }) {
  return (
    <div className="flex items-center gap-1 mx-2 h-6">
      {levels.map((level, i) => (
        <div
          key={i}
          className="w-1 rounded bg-red-500 transition-all duration-75"
          style={{ height: `${Math.max(4, level)}px` }}
        />
      ))}
    </div>
  );
}
