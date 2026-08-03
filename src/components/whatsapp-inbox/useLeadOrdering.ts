import { useMemo } from "react";
import type { Lead, Message } from "../WhatsAppInbox.types";

function removeAccents(str: string) {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function useLeadOrdering(params: {
  messages: Message[];
  unreadMap: Map<string, { unread_count: number; last_unread_at: string | null }>;
  isAdmin: boolean;
  currentLead: string | null;
  leadMeta: Lead | null;
  leadCache: Record<string, any>;
  leadCacheLoaded: boolean;
  search: string;
  hiddenJids: Set<string>;
  tagFilterId: string;
  tagFilterJids: Set<string>;
  onlyUnread: boolean;
  leadSortOrder: "desc" | "asc";
  adminUserFilter: string;
  urlUserFilter: string | null;
  adminFunnelFilter: string;
  myUserId: string | undefined;
  companyId: string | null;
  normalizeJid: (jid: string) => string;
}) {
  const {
    messages, unreadMap, isAdmin, currentLead, leadMeta, leadCache, leadCacheLoaded, search,
    hiddenJids, tagFilterId, tagFilterJids, onlyUnread, leadSortOrder, adminUserFilter,
    urlUserFilter, adminFunnelFilter, myUserId, companyId, normalizeJid,
  } = params;

  const lastMessageByLead = useMemo(() => {
    return messages
      .filter(m => !String(m.message_type || "").includes("reaction"))
      .reduce((acc, msg) => {
        const existing = acc[msg.remote_jid];
        if (!existing || new Date(msg.created_at).getTime() > new Date(existing.created_at).getTime()) acc[msg.remote_jid] = msg;
        return acc;
      }, {} as Record<string, Message>);
  }, [messages]);

  const unreadByJid = useMemo(() => {
    const map = new Map<string, { unread_count: number; last_unread_at: string | null; instance_id: string | null }>();
    unreadMap.forEach((v, key) => {
      const sep = key.indexOf("::");
      const jid = sep >= 0 ? key.slice(0, sep) : key;
      const instance_id = sep >= 0 ? key.slice(sep + 2) : "";
      const prev = map.get(jid);
      const vCount = Number(v?.unread_count) || 0;
      const vLast = (v?.last_unread_at ?? null) as string | null;
      const prevCount = prev?.unread_count || 0;
      const prevLast = prev?.last_unread_at ?? null;
      let takeV = false;
      if (!prev) takeV = true;
      else if (vCount > prevCount) takeV = true;
      else if (vCount === prevCount) {
        if (vLast && !prevLast) takeV = true;
        else if (vLast && prevLast && new Date(vLast).getTime() > new Date(prevLast).getTime()) takeV = true;
      }
      if (takeV) map.set(jid, { unread_count: vCount, last_unread_at: vLast, instance_id: instance_id || prev?.instance_id || null });
      else if (!prevLast && vLast) map.set(jid, { ...prev!, last_unread_at: vLast });
    });
    return map;
  }, [unreadMap]);

  const duplicateLeadSuggestion = useMemo(() => {
    if (!isAdmin || !currentLead || !leadMeta || !leadCacheLoaded) return null;
    const currentJid = currentLead.replace(/@s\.whatsapp\.net$/i, "").replace(/@g\.us$/i, "");
    const base = currentJid.replace(/\D/g, "");
    if (!base.startsWith("55") || base.length < 12) return null;
    let variantBase = "";
    if (base.length === 13 && base[4] === "9") variantBase = base.slice(0, 4) + base.slice(5);
    else if (base.length === 12) variantBase = base.slice(0, 4) + "9" + base.slice(4);
    if (!variantBase) return null;
    const possibleKeys = [variantBase, `${variantBase}@s.whatsapp.net`];
    for (const key of possibleKeys) {
      const duplicate = leadCache[key];
      if (duplicate && duplicate.id !== leadMeta.id) return duplicate;
    }
    return null;
  }, [isAdmin, currentLead, leadMeta, leadCache, leadCacheLoaded]);

  const orderedLeads = useMemo(() => {
    const q = removeAccents((search || "").trim().toLowerCase());
    const entries = Object.entries(leadCache || {}) as Array<[string, any]>;

    return entries
      .filter(([jid]) => (isAdmin || leadCacheLoaded) && Boolean(jid))
      .filter(([jid]) => isAdmin || !hiddenJids.has(jid))
      .filter(([jid, meta]) => Boolean(lastMessageByLead[jid]) || Boolean(meta?.last_message_at) || jid === currentLead || Boolean(q))
      .filter(([_, meta]) => {
        const uids = Array.isArray(meta?.assigned_user_ids) ? meta.assigned_user_ids : (meta?.assigned_user_id ? [String(meta.assigned_user_id)] : []);
        if (!isAdmin) return Boolean(myUserId) && (uids.includes(myUserId) || String(meta?.assigned_user_id) === myUserId);
        const targetFilter = urlUserFilter || adminUserFilter;
        if (targetFilter === "all") return true;
        if (targetFilter === "unassigned") return uids.length === 0 && !meta?.assigned_user_id;
        return uids.includes(targetFilter) || String(meta?.assigned_user_id) === targetFilter;
      })
      .filter(([_, meta]) => !isAdmin || adminFunnelFilter === "all" || meta?.current_funnel_id === adminFunnelFilter)
      .filter(([jid, meta]) => {
        if (!q) return true;
        const number = String(meta?.number_lead ?? meta?.numberLead ?? meta?.number ?? "").toLowerCase();
        const rawLeadCode = String(meta?.lead_name ?? meta?.lead_code ?? "").toLowerCase();
        const leadCode = removeAccents(rawLeadCode);
        const rjid = String(jid || "").toLowerCase();
        if (number.includes(q) || leadCode.includes(q) || rjid.includes(q)) return true;
        return messages.some((m) => {
          const isSameJid = m.remote_jid === jid || normalizeJid(m.remote_jid) === normalizeJid(jid);
          if (!isSameJid) return false;
          return removeAccents(String(m.message || "").toLowerCase()).includes(q);
        });
      })
      .filter(([jid]) => !tagFilterId || tagFilterJids.has(jid) || tagFilterJids.has(normalizeJid(jid)))
      .filter(([jid]) => !onlyUnread || ((unreadByJid.get(normalizeJid(jid))?.unread_count || 0) > 0))
      .sort(([jidA, metaA], [jidB, metaB]) => {
        const aMsg = lastMessageByLead[jidA];
        const bMsg = lastMessageByLead[jidB];
        const ta = (aMsg?.created_at ? new Date(aMsg.created_at).getTime() : 0) || (metaA?.last_message_at ? new Date(metaA.last_message_at).getTime() : 0) || (metaA?.waiting_since ? new Date(metaA.waiting_since).getTime() : 0);
        const tb = (bMsg?.created_at ? new Date(bMsg.created_at).getTime() : 0) || (metaB?.last_message_at ? new Date(metaB.last_message_at).getTime() : 0) || (metaB?.waiting_since ? new Date(metaB.waiting_since).getTime() : 0);
        return leadSortOrder === "asc" ? ta - tb : tb - ta;
      })
      .map(([jid, meta]) => {
        let displayMsg = lastMessageByLead[jid];
        if (q) {
          const matchedMessages = messages.filter((m) => {
            const isSameJid = m.remote_jid === jid || normalizeJid(m.remote_jid) === normalizeJid(jid);
            if (!isSameJid) return false;
            return removeAccents(String(m.message || "").toLowerCase()).includes(q);
          });
          if (matchedMessages.length > 0) {
            matchedMessages.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            displayMsg = matchedMessages[0];
          }
        }
        if (displayMsg) return displayMsg;
        const createdAt = meta?.last_message_at || meta?.waiting_since || new Date(0).toISOString();
        return {
          id: `lead-${jid}`,
          remote_jid: jid,
          company_id: companyId,
          created_at: createdAt,
          from_me: false,
          message: "",
          message_type: null,
          instance_id: unreadByJid.get(normalizeJid(jid))?.instance_id || null,
          read_at: null,
          raw_payload: null,
        } as any as Message;
      });
  }, [
    companyId, leadCache, leadCacheLoaded, isAdmin, hiddenJids, search, tagFilterId, tagFilterJids,
    onlyUnread, unreadByJid, lastMessageByLead, leadSortOrder, adminUserFilter, urlUserFilter,
    adminFunnelFilter, myUserId, currentLead, messages, normalizeJid,
  ]);

  return { lastMessageByLead, unreadByJid, duplicateLeadSuggestion, orderedLeads };
}
