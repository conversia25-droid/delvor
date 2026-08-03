import { useMemo } from "react";
import type { Message } from "../WhatsAppInbox.types";
import { dedupRenderMessages } from "./renderHelpers";

export function useCurrentConversation(params: {
  currentLead: string | null;
  messages: Message[];
  normalizeJid: (jid: string) => string;
  messageDateFrom: string;
  messageDateTo: string;
  visibleMsgCount: number;
}) {
  const { currentLead, messages, normalizeJid, messageDateFrom, messageDateTo, visibleMsgCount } = params;

  const currentMessages = useMemo(() => {
    const currentLeadNorm = currentLead ? normalizeJid(currentLead) : "";
    const arr = currentLead ? messages.filter((m) => normalizeJid(String((m as any)?.remote_jid || "")) === currentLeadNorm) : [];
    const reactions = arr.filter(m => String(m.message_type || "").toLowerCase().includes("reaction"));
    const actualMessages = arr.filter(m => !String(m.message_type || "").toLowerCase().includes("reaction"));
    const merged = actualMessages.map(m => {
      const targetWaId = String(m.message_id || "");
      const msgReactions = reactions.filter(r => {
        const quotedId = String((r as any).quoted_message_id || (r as any).raw_payload?.quoted_message_id || "");
        return quotedId && targetWaId && quotedId.trim() === targetWaId.trim();
      });
      return { ...m, reactions_data: msgReactions.map(r => ({ emoji: r.message || (r as any).raw_payload?.reaction || "❤️", from_me: r.from_me })) };
    });
    return dedupRenderMessages(merged as any);
  }, [currentLead, messages, normalizeJid]);

  const resolveQuotedById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of currentMessages) {
      if ((m as any)?.id) map.set(String((m as any).id), m);
      const p: any = (m as any)?.raw_payload;
      const waid = p?.key?.id || p?.messageId || p?.id || p?.message_id || (m as any)?.message_id || null;
      if (waid) map.set(String(waid), m);
    }
    return (id: string) => map.get(String(id)) || null;
  }, [currentMessages]);

  const filteredCurrentMessages = useMemo(() => {
    if (!currentMessages.length) return currentMessages;
    const from = messageDateFrom ? new Date(messageDateFrom + "T00:00:00").getTime() : null;
    const to = messageDateTo ? new Date(messageDateTo + "T23:59:59").getTime() : null;
    if (!from && !to) return currentMessages;
    return currentMessages.filter((m) => {
      const t = new Date(m.created_at).getTime();
      if (from && t < from) return false;
      if (to && t > to) return false;
      return true;
    });
  }, [currentMessages, messageDateFrom, messageDateTo]);

  const visibleCurrentMessages = useMemo(() => {
    const arr = filteredCurrentMessages;
    if (visibleMsgCount >= arr.length) return arr;
    return arr.slice(Math.max(0, arr.length - visibleMsgCount));
  }, [filteredCurrentMessages, visibleMsgCount]);

  const groupedCurrentMessages = useMemo(() => {
    const result: any[] = [];
    let tempImages: Message[] = [];
    for (let i = 0; i < visibleCurrentMessages.length; i++) {
      const msg = visibleCurrentMessages[i];
      const type = String(msg.message_type || "").toLowerCase();
      const isImageWithoutText = type === "image" && !msg.message?.trim();
      if (isImageWithoutText) {
        tempImages.push(msg);
        const nextMsg = visibleCurrentMessages[i + 1];
        const nextType = String(nextMsg?.message_type || "").toLowerCase();
        const nextIsImageWithoutText = nextType === "image" && !nextMsg?.message?.trim();
        const sameSender = nextMsg?.from_me === msg.from_me;
        const timeDiff = nextMsg ? Math.abs(new Date(msg.created_at).getTime() - new Date(nextMsg.created_at).getTime()) : 99999;
        if (!nextIsImageWithoutText || !sameSender || timeDiff > 60000) {
          if (tempImages.length > 1) {
            result.push({ isGroup: true, id: `group-${tempImages[0].id}`, from_me: msg.from_me, created_at: tempImages[tempImages.length - 1].created_at, messages: tempImages });
          } else {
            result.push(tempImages[0]);
          }
          tempImages = [];
        }
      } else {
        result.push(msg);
      }
    }
    return result;
  }, [visibleCurrentMessages]);

  return { currentMessages, resolveQuotedById, filteredCurrentMessages, visibleCurrentMessages, groupedCurrentMessages };
}
