import { useState } from "react";
import {
  Check,
  CheckCheck,
  Loader2,
  FileText,
  Mic,
  Image as ImageIcon,
  MapPin,
  Reply,
  Copy,
  CornerDownRight,
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";

import type { ChatMessage } from "./types";

interface Props {
  message: ChatMessage;
  /** Mensagem citada (já resolvida pelo pai). Render acima do balão. */
  quotedMessage?: ChatMessage | null;
  /** Nome do remetente (se for de outro atendente) */
  showSenderName?: boolean;
  /** Callbacks de ação (responder/copiar) */
  onReply?: (msg: ChatMessage) => void;
  /** Quando o usuário clica em "ir pra mensagem citada" */
  onScrollToQuoted?: (messageId: string) => void;
  /** Highlight (ex: resultado de busca) */
  highlight?: boolean;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function StatusIcon({ status }: { status: string | null | undefined }) {
  if (!status || status === "queued") return <Loader2 className="h-3 w-3 animate-spin opacity-60" />;
  if (status === "sent")      return <Check className="h-3 w-3 opacity-60" />;
  if (status === "delivered") return <CheckCheck className="h-3 w-3 opacity-60" />;
  if (status === "read")      return <CheckCheck className="h-3 w-3 text-sky-300" />;
  if (status === "failed")    return <span className="text-rose-400 text-[10px]">!</span>;
  return null;
}

function previewQuoted(q: ChatMessage | null | undefined): { icon: any; text: string } {
  if (!q) return { icon: null, text: "Mensagem" };
  const type = q.message_type;
  if (type === "imageMessage")    return { icon: ImageIcon, text: q.message || "Imagem" };
  if (type === "audioMessage")    return { icon: Mic, text: "Áudio" };
  if (type === "videoMessage")    return { icon: ImageIcon, text: q.message || "Vídeo" };
  if (type === "documentMessage") return { icon: FileText, text: q.message || "Documento" };
  return { icon: null, text: q.message || "" };
}

export default function MessageBubble({
  message,
  quotedMessage,
  showSenderName,
  onReply,
  onScrollToQuoted,
  highlight,
}: Props) {
  const [imgError, setImgError] = useState(false);
  const [hovered, setHovered] = useState(false);

  const fromMe = message.from_me;
  const align = fromMe ? "items-end" : "items-start";
  const bg = fromMe
    ? "bg-blue-600/90 text-white"
    : "bg-white/[0.06] text-slate-100";
  const rounded = fromMe ? "rounded-tr-sm" : "rounded-tl-sm";

  const type = message.message_type;
  const isImage = type === "imageMessage" && message.media_url;
  const isAudio = type === "audioMessage" && message.media_url;
  const isVideo = type === "videoMessage" && message.media_url;
  const isDoc   = type === "documentMessage" && message.media_url;

  const quotedPreview = previewQuoted(quotedMessage);
  const QuotedIcon = quotedPreview.icon;

  function handleCopy() {
    const txt = message.message || message.media_url || "";
    if (!txt) return;
    navigator.clipboard?.writeText(txt);
    toast({ title: "Copiado" });
  }

  return (
    <div
      className={`flex flex-col ${align} gap-0.5 mb-2 group ${highlight ? "ring-2 ring-amber-400 rounded-2xl" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-message-id={message.message_id}
    >
      {showSenderName && !fromMe && (
        <span className="text-[10px] text-slate-400 px-2">{message.remote_jid}</span>
      )}

      <div className="flex items-center gap-1 max-w-[78%]">
        {/* Ações à esquerda quando hover (msgs do contato) */}
        {!fromMe && hovered && onReply && (
          <button
            type="button"
            className="opacity-60 hover:opacity-100 transition shrink-0"
            onClick={() => onReply(message)}
            title="Responder"
          >
            <Reply className="h-3.5 w-3.5" />
          </button>
        )}

        <div className={`rounded-2xl ${rounded} px-3 py-2 ${bg} shadow-sm flex-1 min-w-0`}>
          {/* QUOTE — mensagem citada */}
          {quotedMessage && (
            <button
              type="button"
              onClick={() => message.context_quoted_message_id && onScrollToQuoted?.(message.context_quoted_message_id)}
              className={`flex items-stretch gap-2 mb-1.5 rounded overflow-hidden text-left w-full
                ${fromMe ? "bg-white/15" : "bg-white/[0.05]"}`}
            >
              <div className={`w-1 ${fromMe ? "bg-white/60" : "bg-blue-400"}`} />
              <div className="py-1 pr-2 min-w-0">
                <p className="text-[10px] font-semibold opacity-80">
                  {quotedMessage.from_me ? "Você" : "Cliente"}
                </p>
                <p className="text-xs truncate opacity-90 flex items-center gap-1">
                  {QuotedIcon && <QuotedIcon className="h-3 w-3" />}
                  {quotedPreview.text}
                </p>
              </div>
            </button>
          )}

          {/* MÍDIA */}
          {isImage && !imgError && (
            <a href={message.media_url!} target="_blank" rel="noreferrer" className="block mb-1">
              <img
                src={message.media_url!}
                alt="Imagem"
                className="rounded-lg max-h-64 object-cover"
                onError={() => setImgError(true)}
              />
            </a>
          )}
          {isImage && imgError && (
            <div className="flex items-center gap-2 text-xs opacity-80 mb-1">
              <ImageIcon className="h-4 w-4" /> Imagem (falha ao carregar)
            </div>
          )}

          {isAudio && (
            <div className="flex items-center gap-2 mb-1">
              <Mic className="h-4 w-4 shrink-0" />
              <audio controls src={message.media_url!} className="max-w-[220px] h-8" />
            </div>
          )}

          {isVideo && (
            <video controls className="rounded-lg max-h-64 mb-1" src={message.media_url!} />
          )}

          {isDoc && (
            <a
              href={message.media_url!}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-sm underline mb-1"
            >
              <FileText className="h-4 w-4" /> {message.message || "Abrir documento"}
            </a>
          )}

          {type === "locationMessage" && (
            <div className="flex items-center gap-1 text-xs opacity-80 mb-1">
              <MapPin className="h-3 w-3" /> Localização
            </div>
          )}

          {/* TEXTO */}
          {message.message && type !== "documentMessage" && (
            <p className="text-sm whitespace-pre-wrap break-words leading-snug">
              {message.message}
            </p>
          )}

          {/* RODAPÉ */}
          <div className="flex items-center gap-1 justify-end mt-0.5 text-[10px] opacity-70">
            <span>{formatTime(message.created_at)}</span>
            {fromMe && <StatusIcon status={message.status} />}
          </div>
        </div>

        {/* Ações à direita quando hover (msgs minhas) */}
        {fromMe && hovered && (
          <div className="flex flex-col gap-1 shrink-0">
            {onReply && (
              <button
                type="button"
                className="opacity-60 hover:opacity-100 transition"
                onClick={() => onReply(message)}
                title="Responder"
              >
                <CornerDownRight className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              className="opacity-60 hover:opacity-100 transition"
              onClick={handleCopy}
              title="Copiar"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
