import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";

interface Message {
  id: string;
  remote_jid: string;
  from_me: boolean;
  message: string | null;
  message_type: string;
  media_url?: string | null;
  created_at: string;
  ack?: number;
}

interface ChatWindowProps {
  currentLead: string | null;
  isSwitchingChat: boolean;
  messages: Message[];

  isMobile: boolean;
  onBackMobile: () => void;

  renderTopMetaBar: () => JSX.Element;
  renderMessageBody: (msg: Message) => JSX.Element;
  renderAck: (ack?: number) => JSX.Element;

  renderInput: () => JSX.Element;
}

export default function ChatWindow({
  currentLead,
  isSwitchingChat,
  messages,
  isMobile,
  onBackMobile,
  renderTopMetaBar,
  renderMessageBody,
  renderAck,
  renderInput,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Scroll automático
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Placeholder: nenhuma conversa selecionada
  if (!currentLead && !isSwitchingChat) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm opacity-60">
        Selecione uma conversa
      </div>
    );
  }

  // Loading ao trocar de conversa
  if (isSwitchingChat) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin opacity-60" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Topo */}
      <div className="border-b p-2 flex items-center gap-2">
        {isMobile && (
          <Button variant="ghost" size="sm" onClick={onBackMobile}>
            ←
          </Button>
        )}
        {renderTopMetaBar()}
      </div>

      {/* Mensagens */}
      <ScrollArea className="flex-1 p-4">
        <div className="flex flex-col gap-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.from_me ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow
                  ${
                    msg.from_me
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
              >
                {renderMessageBody(msg)}

                <div className="mt-1 flex justify-end items-center gap-1 text-[10px] opacity-60">
                  <span>
                    {new Date(msg.created_at).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {msg.from_me && renderAck(msg.ack)}
                </div>
              </div>
            </div>
          ))}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-2">
        {renderInput()}
      </div>
    </div>
  );
}
