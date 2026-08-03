import { useMemo, useState } from "react";
import { Search, MessageSquare, Smartphone, Eye, EyeOff, ArrowDown, ArrowUp, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

import type { ChatConversation } from "./types";

interface Props {
  conversations: ChatConversation[];
  loading: boolean;
  selectedKey: string | null;
  onSelect: (conv: ChatConversation) => void;
  instances: Array<{ name: string; label: string | null }>;
  /** Chaves de conversas com pulse animation (msg nova chegou) */
  pulseKeys?: Set<string>;
}

function formatListDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    if (sameDay) {
      return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    if (d.getDate() === yest.getDate() && d.getMonth() === yest.getMonth() && d.getFullYear() === yest.getFullYear()) {
      return "ontem";
    }
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
}

function previewText(conv: ChatConversation): string {
  if (!conv.last_message_type || conv.last_message_type === "conversation" || conv.last_message_type === "extendedTextMessage") {
    return conv.last_message || "";
  }
  const map: Record<string, string> = {
    imageMessage: "📷 Imagem",
    audioMessage: "🎵 Áudio",
    videoMessage: "🎥 Vídeo",
    documentMessage: "📄 Documento",
    stickerMessage: "🪄 Figurinha",
    locationMessage: "📍 Localização",
    contactMessage: "👤 Contato",
  };
  return map[conv.last_message_type] || (conv.last_message || "Mensagem");
}

export default function ConversationList({
  conversations, loading, selectedKey, onSelect, instances, pulseKeys,
}: Props) {
  const [search, setSearch] = useState("");
  const [filterInstance, setFilterInstance] = useState<string>("all");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [limit, setLimit] = useState(60);

  /* ---- FILTROS ---- */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = conversations.filter((c) => {
      if (filterInstance !== "all" && c.instance_id !== filterInstance) return false;
      if (onlyUnread && c.unread_count === 0) return false;
      if (!q) return true;
      const blob = `${c.display_name || ""} ${c.remote_jid} ${c.last_message || ""}`.toLowerCase();
      return blob.includes(q);
    });
    arr = [...arr].sort((a, b) => {
      const dt = new Date(a.last_message_at).getTime() - new Date(b.last_message_at).getTime();
      return sortOrder === "desc" ? -dt : dt;
    });
    return arr;
  }, [conversations, search, filterInstance, onlyUnread, sortOrder]);

  /* ---- STATS DE UNREAD ---- */
  const unreadStats = useMemo(() => {
    let convCount = 0;
    let msgCount = 0;
    for (const c of conversations) {
      if (c.unread_count > 0) {
        convCount += 1;
        msgCount += c.unread_count;
      }
    }
    return { convCount, msgCount };
  }, [conversations]);

  return (
    <div className="flex flex-col h-full border-r border-border/50">
      <style>{`
        @keyframes pulse-soft {
          0%   { background-color: rgba(139, 92, 246, 0.10) }
          50%  { background-color: rgba(139, 92, 246, 0.22) }
          100% { background-color: rgba(139, 92, 246, 0.10) }
        }
      `}</style>

      {/* SEARCH */}
      <div className="px-3 pt-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 opacity-60" />
          <Input
            placeholder="Buscar conversa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-9 h-9 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition"
              aria-label="Limpar busca"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* TOGGLE NÃO LIDAS + INSTÂNCIAS */}
      <div className="px-3 pt-2 flex items-center gap-2">
        <Button
          type="button"
          variant={onlyUnread ? "default" : "outline"}
          size="sm"
          className="h-8"
          onClick={() => setOnlyUnread((v) => !v)}
        >
          {onlyUnread ? <EyeOff className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
          Não lidas
        </Button>

        {instances.length > 1 && (
          <select
            value={filterInstance}
            onChange={(e) => setFilterInstance(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs flex-1 min-w-0 truncate opacity-80 hover:opacity-100"
          >
            <option value="all">📱 Todas instâncias</option>
            {instances.map((i) => (
              <option key={i.name} value={i.name}>
                {i.label || i.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ORDENAÇÃO + BADGE */}
      <div className="px-3 pt-2 pb-2 flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant={sortOrder === "desc" ? "default" : "outline"}
            size="sm"
            className="h-7 w-7 p-0"
            title="Mais recentes primeiro"
            onClick={() => setSortOrder("desc")}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant={sortOrder === "asc" ? "default" : "outline"}
            size="sm"
            className="h-7 w-7 p-0"
            title="Mais antigas primeiro"
            onClick={() => setSortOrder("asc")}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="ml-auto">
          {unreadStats.msgCount > 0 ? (
            <span className="text-[10px] bg-primary/10 text-primary border border-primary/30 px-2 py-0.5 rounded-full font-semibold animate-in fade-in transition-all whitespace-nowrap">
              {unreadStats.convCount} ({unreadStats.msgCount})
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground opacity-70 px-2 py-0.5 whitespace-nowrap">
              Tudo lido 🎉
            </span>
          )}
        </div>
      </div>

      {/* LISTA */}
      <div
        className="flex-1 overflow-y-auto custom-scrollbar pr-1"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
            setLimit((p) => p + 60);
          }
        }}
      >
        {loading && conversations.length === 0 && (
          <div className="px-2 py-2 space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded-lg">
                <div className="h-10 w-10 rounded-full bg-muted/60 animate-pulse shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="h-3 bg-muted/60 animate-pulse rounded" style={{ width: `${45 + (i % 4) * 10}%` }} />
                  <div className="h-2.5 bg-muted/40 animate-pulse rounded" style={{ width: `${55 + (i % 3) * 12}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="p-6 text-center">
            <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">
              {conversations.length === 0 ? "Sem conversas ainda" : "Nada bate com os filtros"}
            </p>
          </div>
        )}

        {!loading && filtered.slice(0, limit).map((conv) => {
          const selected = conv.key === selectedKey;
          const isUnread = conv.unread_count > 0;
          const shouldPulse = pulseKeys?.has(conv.key) && !selected;

          return (
            <button
              key={conv.key}
              type="button"
              onClick={() => onSelect(conv)}
              className={`w-full text-left flex items-center gap-3 p-3 cursor-pointer transition-all border-b border-border/30 border-l-[3px]
                ${selected
                  ? "bg-muted border-l-primary"
                  : isUnread
                    ? "bg-blue-50/50 dark:bg-blue-900/20 border-l-transparent shadow-sm"
                    : "hover:bg-muted/50 border-l-transparent"
                }
                ${shouldPulse ? "animate-[pulse-soft_2s_infinite]" : ""}`}
            >
              {/* AVATAR */}
              <div className="relative shrink-0">
                <Avatar className="h-11 w-11">
                  <AvatarFallback className={isUnread
                    ? "bg-primary/15 text-primary font-bold"
                    : conv.customer_id
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-muted text-muted-foreground"}>
                    {(conv.display_name?.slice(0, 2) || conv.remote_jid?.slice(-2) || "??").toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {isUnread && (
                  <span className="absolute -top-0.5 -right-0.5 h-5 min-w-[20px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-card">
                    {conv.unread_count > 99 ? "99+" : conv.unread_count}
                  </span>
                )}
              </div>

              {/* INFO */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm truncate ${isUnread ? "font-bold text-foreground" : "font-medium"}`}>
                    {conv.display_name || `+${conv.remote_jid}`}
                  </span>
                  <span className={`text-[10px] shrink-0 ${isUnread ? "text-blue-400 font-semibold" : "text-muted-foreground"}`}>
                    {formatListDate(conv.last_message_at)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className={`text-xs truncate ${isUnread ? "text-foreground/80" : "text-muted-foreground"}`}>
                    {conv.last_from_me && <span className="text-blue-300/70">você: </span>}
                    {previewText(conv)}
                  </span>
                </div>

                {(conv.instance_label || conv.customer_id) && (
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground/80">
                    {conv.instance_label && (
                      <span className="inline-flex items-center gap-0.5">
                        <Smartphone className="h-2.5 w-2.5" />
                        {conv.instance_label}
                      </span>
                    )}
                    {conv.customer_id && (
                      <span className="inline-flex items-center gap-0.5 text-emerald-400/80">
                        ● cliente
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>
          );
        })}

        {filtered.length > limit && (
          <div className="text-center py-3 text-xs text-muted-foreground">
            Mostrando {limit} de {filtered.length} — role pra ver mais
          </div>
        )}
      </div>
    </div>
  );
}
