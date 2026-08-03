import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search } from "lucide-react";

interface Message {
  remote_jid: string;
  instance_id: string;
  message: string | null;
  message_type: string;
  created_at: string;
}

interface Tag {
  id: string;
  name: string;
}

interface ChatSidebarProps {
  orderedLeads: Message[];
  currentLead: string | null;
  search: string;
  setSearch: (v: string) => void;

  tagsCatalog: Tag[];
  tagFilterId: string;
  setTagFilterId: (v: string) => void;
  loadingTagFilter: boolean;

  unreadMap: Map<string, { unread_count: number }>;
  pulseMap: Map<string, number>;

  onSelectLead: (jid: string) => Promise<void>;
  onOpenContextMenu: (e: React.MouseEvent, jid: string) => void;
}

export default function ChatSidebar({
  orderedLeads,
  currentLead,
  search,
  setSearch,
  tagsCatalog,
  tagFilterId,
  setTagFilterId,
  loadingTagFilter,
  unreadMap,
  pulseMap,
  onSelectLead,
  onOpenContextMenu,
}: ChatSidebarProps) {
  return (
    <div className="w-full md:w-80 flex flex-col gap-4">
      {/* FILTRO POR TAG */}
      <div className="flex flex-col gap-1">
        <label className="text-xs opacity-70">Filtrar por tag</label>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={tagFilterId}
          onChange={(e) => setTagFilterId(e.target.value)}
        >
          <option value="">Todas as conversas</option>
          {tagsCatalog.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {loadingTagFilter && tagFilterId && (
          <span className="text-[11px] opacity-60">Carregando filtro…</span>
        )}
      </div>

      {/* BUSCA */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 opacity-60" />
        <Input
          placeholder="Buscar lead..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* LISTA */}
      <ScrollArea className="flex-1">
        {orderedLeads.map((msg) => {
          const key = `${msg.remote_jid}-${msg.instance_id}`;
          const unreadInfo = unreadMap.get(key);
          const unreadCount = unreadInfo?.unread_count || 0;
          const shouldPulse =
            (pulseMap.get(key) || 0) > Date.now() &&
            currentLead !== msg.remote_jid;

          return (
            <Card
              key={key}
              onClick={() => onSelectLead(msg.remote_jid)}
              onContextMenu={(e) => onOpenContextMenu(e, msg.remote_jid)}
              className={`cursor-pointer ${
                currentLead === msg.remote_jid
                  ? "bg-muted"
                  : unreadCount > 0
                  ? "bg-primary/10 hover:bg-primary/15"
                  : "hover:bg-muted"
              } ${shouldPulse ? "animate-[pulse-soft_2s_infinite]" : ""}`}
            >
              <CardContent className="p-4 flex flex-col gap-1">
                <div className="flex gap-3 items-center justify-between">
                  <div className="flex gap-3 items-center min-w-0">
                    <Avatar>
                      <AvatarFallback>
                        {msg.remote_jid.slice(-2)}
                      </AvatarFallback>
                    </Avatar>

                    <p className="font-semibold truncate">
                      {msg.remote_jid}
                    </p>
                  </div>

                  {unreadCount > 0 && (
                    <span className="min-w-[20px] h-[20px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </div>

                <p className="text-xs opacity-70 truncate">
                  {msg.message
                    ? msg.message
                    : msg.message_type === "audio"
                    ? "🎙️ Áudio"
                    : msg.message_type === "image"
                    ? "🖼️ Imagem"
                    : msg.message_type === "video"
                    ? "🎥 Vídeo"
                    : msg.message_type === "document"
                    ? "📄 Documento"
                    : "Mensagem"}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </ScrollArea>
    </div>
  );
}
