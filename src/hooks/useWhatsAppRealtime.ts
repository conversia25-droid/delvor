import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/* =====================================================
   TIPOS
===================================================== */

export interface WppConversation {
  id: string;
  company_id: string;
  remote_jid: string;
  instance_id: string;
  last_message: string | null;
  last_message_at: string;
}

interface UnreadRow {
  remote_jid: string;
  unread_count: number;
}

/* =====================================================
   HOOK
===================================================== */

export function useWhatsAppRealtime(companyId: string | null) {
  const [conversations, setConversations] = useState<WppConversation[]>([]);
  const [unreadMap, setUnreadMap] = useState<Map<string, { unread_count: number }>>(
    new Map()
  );
  const [pulseMap, setPulseMap] = useState<Map<string, number>>(new Map());

  const channelRef = useRef<any>(null);

  /* =====================================================
     LOAD CONVERSATIONS
  ===================================================== */

  const loadConversations = useCallback(async () => {
    if (!companyId) return;

    const { data, error } = await supabase
      .from("wpp_conversations")
      .select("*")
      .eq("company_id", companyId)
      .order("last_message_at", { ascending: false });

    if (error) {
      console.error("Erro ao carregar conversas:", error);
      return;
    }

    setConversations(data || []);
  }, [companyId]);

  /* =====================================================
     LOAD UNREAD
  ===================================================== */

  const loadUnreadByConversation = useCallback(async () => {
    if (!companyId) return;

    const { data, error } = await supabase
      .from("v_unread_by_conversation")
      .select("*")
      .eq("company_id", companyId);

    if (error) {
      console.error("Erro ao carregar unread:", error);
      return;
    }

    const map = new Map<string, { unread_count: number }>();
    (data as UnreadRow[] | null)?.forEach((row) => {
      map.set(row.remote_jid, { unread_count: row.unread_count });
    });

    setUnreadMap(map);
  }, [companyId]);

  /* =====================================================
     PULSE (NOVAS MENSAGENS)
  ===================================================== */

  function schedulePulse(remoteJid: string) {
    setPulseMap((prev) => {
      const next = new Map(prev);
      next.set(remoteJid, Date.now() + 10_000);
      return next;
    });
  }

  /* =====================================================
     REALTIME
  ===================================================== */

  useEffect(() => {
    if (!companyId) return;

    // carga inicial
    loadConversations();
    loadUnreadByConversation();

    const channel = supabase
      .channel("wpp-conversations-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wpp_conversations",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const conv = payload.new as WppConversation | null;
          if (conv?.remote_jid) {
            schedulePulse(conv.remote_jid);
          }

          loadConversations();
          loadUnreadByConversation();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [companyId, loadConversations, loadUnreadByConversation]);

  /* =====================================================
     ACTIONS
  ===================================================== */

  async function markConversationAsRead(remoteJid: string) {
    if (!companyId) return;

    await supabase.rpc("mark_conversation_as_read", {
      p_company_id: companyId,
      p_remote_jid: remoteJid,
    });

    loadUnreadByConversation();
  }

  async function deleteConversation(remoteJid: string) {
    if (!companyId) return;

    await supabase
      .from("wpp_conversations")
      .delete()
      .eq("company_id", companyId)
      .eq("remote_jid", remoteJid);

    setConversations((prev) =>
      prev.filter((c) => c.remote_jid !== remoteJid)
    );

    setUnreadMap((prev) => {
      const next = new Map(prev);
      next.delete(remoteJid);
      return next;
    });
  }

  /* =====================================================
     RETURN
  ===================================================== */

  return {
    conversations,
    orderedLeads: conversations, // compatível com o Inbox
    unreadMap,
    pulseMap,

    loadConversations,
    loadUnreadByConversation,

    markConversationAsRead,
    deleteConversation,
  };
}
