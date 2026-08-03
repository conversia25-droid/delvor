import { useEffect, useMemo, useRef, useState, useLayoutEffect, lazy, Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AudioMessage } from "@/components/AudioMessage";
import LeadTagsBox from "@/components/LeadTagsBox";
import infinityBotIcon from "@/assets/infinitybot.ico";
const InfinityBotSheet = lazy(() => import("@/components/InfinityBotSheet"));
import QuickMessagesPopover from "@/components/whatsapp-inbox/QuickMessagesPopover";
import { useLocation } from "react-router-dom";
import { Eye, EyeOff, RefreshCcw, Tag, ArrowUp, ArrowDown, Send, Search, User, Check, CheckCheck, Trash2, X, CornerUpLeft, Clock, AlertCircle, Calendar, Smile, Forward, ChevronUp, ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { MEDIA_CONFIG } from "./WhatsAppInbox.media";
import type { MediaType, Message, Lead, Funnel, FunnelStage, Tag as TagType, Instancia, UUID } from "./WhatsAppInbox.types";
import { getFonteVisual, formatFonte, getInstanceStatusColor, formatListDate, dedupMessages, mergePreferNonNull, getMessageDedupKey } from "./WhatsAppInbox.utils.tsx";
import { fetchLastMessagePerJid, type LastMsgEntry } from "@/lib/lastMessageMap";
import { sendYCloudMessage, uploadMediaToStorage } from "@/lib/ycloudSend";
import { SendTemplateDialog } from "@/components/SendTemplateDialog";
import { WhatsAppLogo } from "./whatsapp-inbox/InboxShared";
import { InboxEmptyState } from "./whatsapp-inbox/InboxEmptyState";
import { HiddenConversationsDialog } from "./whatsapp-inbox/HiddenConversationsDialog";
import { ConversationContextMenu } from "./whatsapp-inbox/ConversationContextMenu";
import { AddUserDialog } from "./whatsapp-inbox/AddUserDialog";

function __readEnvVar(name: string): string | undefined {
  // Runtime config (window.__OSM_ENV__) prevalece sobre import.meta.env
  if (typeof window !== "undefined") {
    const w = (window as any).__OSM_ENV__;
    const v = w?.[name];
    if (typeof v === "string" && v && !v.startsWith("${") && !v.includes("VITE_")) {
      return v;
    }
  }
  return (import.meta.env as any)?.[name];
}
const ____INBOX_WEBHOOK_URL: string | undefined =
  __readEnvVar("VITE_INBOX_TEXT_WEBHOOK_URL") ||
  __readEnvVar("VITE_INBOX_MEDIA_WEBHOOK_URL") ||
  __readEnvVar("VITE_WHATSAPP_WEBHOOK_URL");

const __postJson = async (url: string, payload: any) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text().catch(() => "");
  
  // Se o n8n retornar apenas "true" ou "OK", não queremos que o app quebre
  if (bodyText.trim().toLowerCase() === "true") return { success: true };
  if (bodyText.trim().toLowerCase() === "ok") return { success: true };

  let data: any = null;
  try { 
    data = bodyText ? JSON.parse(bodyText) : null; 
  } catch (e) { 
    console.warn("Resposta do webhook não é JSON, mas foi enviada:", bodyText);
    data = { raw: bodyText }; 
  }

  if (!response.ok) {
    const err = new Error(bodyText || `Webhook error: ${response.status}`);
    throw err;
  }
  return data;
};

const __resolveInstance = (instancias: any[], candidate: any) => {
  if (!candidate || !instancias?.length) return null;
  const candStr = String(candidate);
  const candNum = Number(candStr);
  const found =
    instancias.find((i: any) => i?.instance_key === candStr) ||
    instancias.find((i: any) => i?.token_id === candStr) ||
    instancias.find((i: any) => i?.id === candStr) ||
    (Number.isFinite(candNum)
      ? instancias.find((i: any) => Number(i?.phone_number) === candNum)
      : null);
  return found || null;
};

const __sendTextWebhook = async (instanciasList: any[], instanceCandidate: string, payloadObj: any) => {
  if (!____INBOX_WEBHOOK_URL) {
    throw new Error("INBOX webhook URL não configurada.");
  }

  const inst = __resolveInstance(instanciasList || [], instanceCandidate);
  const finalInstanceKey = (inst?.instance_key as string | undefined) || (instanceCandidate ? String(instanceCandidate) : null);
  const finalPhone = (inst?.phone_number as number | null | undefined) ?? null;
  
  const data: any = await __postJson(____INBOX_WEBHOOK_URL, {
    type: "text",
    number: payloadObj?.number,
    text: payloadObj?.text,
    quoted: payloadObj?.quoted ?? null,
    instance_key: finalInstanceKey ? finalInstanceKey : null,
    instance_phone_number: finalPhone,
    instance_id: finalPhone,
    company_id: payloadObj?.company_id ?? null,
    sent_by_name: payloadObj?.sent_by_name ?? null,
    sent_by_role: payloadObj?.sent_by_role ?? null,
    sent_by_user_id: payloadObj?.sent_by_user_id ?? null,
    local_client_id: payloadObj?.local_client_id ?? null,
    sent_at: payloadObj?.sent_at ?? null,
    quoted_message_id: payloadObj?.quoted_message_id ?? null,
    my_context: payloadObj?.my_context ?? null,
    raw_payload: payloadObj?.raw_payload ?? {
      local_client_id: payloadObj?.local_client_id ?? null,
      sent_at: payloadObj?.sent_at ?? null,
      sent_by_name: payloadObj?.sent_by_name ?? null,
      sent_by_role: payloadObj?.sent_by_role ?? null,
      sent_by_user_id: payloadObj?.sent_by_user_id ?? null,
      quoted_message_id: payloadObj?.quoted_message_id ?? null,
      my_context: payloadObj?.my_context ?? null,
      quoted: payloadObj?.quoted ?? null,
    },
  });
  return {
    data,
    usedInstanceId:
      (data?.instance_id as string) ||
      (finalInstanceKey as string) ||
      (instanceCandidate as string) ||
      "",
  };
};

const __sendReactionWebhook = async (instanciasList: any[], instanceCandidate: string, payloadObj: any) => {
  if (!____INBOX_WEBHOOK_URL) {
    throw new Error("INBOX webhook URL não configurada.");
  }

  const inst = __resolveInstance(instanciasList || [], instanceCandidate);
  const finalInstanceKey = (inst?.instance_key as string | undefined) || (instanceCandidate ? String(instanceCandidate) : null);
  const finalPhone = (inst?.phone_number as number | null | undefined) ?? null;

  return await __postJson(____INBOX_WEBHOOK_URL, {
    type: "reaction",
    reaction: payloadObj?.reaction,
    messageId: payloadObj?.messageId,
    fromMe: payloadObj?.fromMe,
    quoted_message_id: payloadObj?.quoted_message_id || payloadObj?.messageId,
    number: payloadObj?.number,
    instance_key: finalInstanceKey,
    instance_phone_number: finalPhone,
    company_id: payloadObj?.company_id,
    sent_by_user_id: payloadObj?.sent_by_user_id,
    sent_by_name: payloadObj?.sent_by_name
  });
};

function MessageReactions({ msg }: { msg: any }) {
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

function RenderQuotedMessage({ msg, currentLeadName, resolveQuotedById, onScrollToMessage }: any) {
  try {
    let payload = (msg as any)?.raw_payload;
    if (typeof payload === "string") {
      try { payload = payload.startsWith("{") ? JSON.parse(payload) : null; } 
      catch (e) { payload = null; }
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
        quotedBody = qText || 
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
      <div
        className="mb-2 rounded-md border-l-4 border-primary/60 bg-white/10 p-2 text-sm shadow-sm select-none overflow-hidden max-w-full cursor-pointer hover:bg-white/20 transition"
        onClick={(e) => {
          e.stopPropagation();
          if (qid && onScrollToMessage) onScrollToMessage(String(qid));
        }}
        title="Clique para ver a mensagem original"
      >
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

function RecordingWaveBars({ levels }: { levels: number[] }) {
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

const __normText = (v: any) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const __safeTime = (v: any) => { const t = new Date(v as any).getTime(); return Number.isFinite(t) ? t : 0; };

const __getWaMessageId = (m: any): string | null => {
  const p = m?.raw_payload;
  return p?.key?.id || p?.message?.key?.id || p?.data?.key?.id || p?.msg?.key?.id || p?.messages?.[0]?.key?.id || null;
};

const __dedupRenderMessages = (arr: Message[]): Message[] => {
  if (!arr?.length) return arr;
  const ordered = [...arr].sort((a, b) => __safeTime(a.created_at) - __safeTime(b.created_at));

  type Bucket = { msg: Message; score: number; firstTime: number };
  const map = new Map<string, Bucket>();

  const scoreMsg = (m: any) => {
    const role = m?.raw_payload?.sent_by_role;
    let s = 0;
    if (role === "admin") s += 100;
    if (m?.read_at) s += 6;
    if (m?.delivered_at) s += 4;
    if (m?.sent_at || m?.raw_payload?.sent_at) s += 2;
    if (m?.raw_payload) s += 1;
    return s;
  };

  for (const m of ordered) {
    const waId = __getWaMessageId(m);
    const localId = (m as any)?._local_client_id || (m as any)?.raw_payload?.local_client_id || (m as any)?.local_client_id;
    
    let key = "";

    if (localId) {
        key = `local_id:${localId}`;
    } else if (waId) {
         key = `wa:${m.company_id}:${m.remote_jid}:${waId}`;
    } else {
        const tBucket = Math.floor(__safeTime(m.created_at) / 5000) * 5000;
        const textKey = __normText(m.message || (m as any)?.raw_payload?.text || (m as any)?.raw_payload?.caption);
        const typeKey = m.message_type || (m as any)?.raw_payload?.type || "text";
        const mediaKey = m.media_url || (m as any)?._local_preview_url || (typeKey === 'image' ? Math.random().toString() : "");

        key = `h:${m.company_id}:${m.remote_jid}:${Boolean(m.from_me)}:${typeKey}:${tBucket}:${textKey}:${mediaKey}`;
    }

    const s = scoreMsg(m);
    const prev = map.get(key);
    
    if (!prev) {
      map.set(key, { msg: m, score: s, firstTime: __safeTime(m.created_at) });
      continue;
    }

    const keepCurrent = s >= prev.score;
    const preferred = keepCurrent ? m : prev.msg;
    const fallback = keepCurrent ? prev.msg : m;
    const merged = mergePreferNonNull(preferred as any, fallback as any) as Message;
    map.set(key, {
      msg: merged,
      score: Math.max(s, prev.score),
      firstTime: prev.firstTime,
    });
  }

  return Array.from(map.values())
    .sort((a, b) => a.firstTime - b.firstTime)
    .map((x) => x.msg);
};

type PendingMedia = { file: File; url: string; type: MediaType };

interface WhatsAppInboxProps {
  showLite?: boolean;
  showApi?: boolean;
}

export default function WhatsAppInbox({ showLite = true, showApi = true }: WhatsAppInboxProps = {}) {
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const urlUserFilter = urlParams.get("user");
  
  const getLeadIdFromUrl = () => { try { return new URLSearchParams(window.location.search).get("leadId"); } catch { return null; } };
  const getJidFromUrl = () => { try { return new URLSearchParams(window.location.search).get("jid"); } catch { return null; } };

  /** Escreve leadId na URL e remove jid (preferido). Se só tiver jid, usa jid como fallback. */
  const setLeadInUrl = (leadId: string | null | undefined, jid: string | null | undefined, mode: "push" | "replace" = "push") => {
    const url = new URL(window.location.href);
    if (leadId) {
      url.searchParams.set("leadId", leadId);
      url.searchParams.delete("jid");
    } else if (jid) {
      url.searchParams.set("jid", jid);
      url.searchParams.delete("leadId");
    } else {
      return;
    }
    if (mode === "replace") window.history.replaceState({}, "", url.toString());
    else window.history.pushState({}, "", url.toString());
  };

  const clearChatParamsInUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("jid");
    url.searchParams.delete("leadId");
    window.history.replaceState({}, "", url.toString());
  };

  const [jidFromUrl, setJidFromUrlState] = useState<string | null>(() => getJidFromUrl());
  const [addUserLead, setAddUserLead] = useState<any | null>(null);
  const [addUserSelectedId, setAddUserSelectedId] = useState<string>("unassigned");
  const [addUserCurrentIds, setAddUserCurrentIds] = useState<string[]>([]);

  // --- ESTADOS DE ENCAMINHAMENTO ---
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [forwardSelectedJids, setForwardSelectedJids] = useState<Set<string>>(new Set());
  const [forwardSearch, setForwardSearch] = useState("");
  const [isForwarding, setIsForwarding] = useState(false);
  // ---------------------------------

  const [audioLevels, setAudioLevels] = useState<number[]>([4, 4, 4, 4, 4]);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const onPopState = () => setJidFromUrlState(getJidFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 1024px)").matches);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const jid = params.get("jid");
    const leadId = params.get("leadId");
    if (!jid && !leadId) {
      setCurrentLead(null);
      setLeadMeta(null);
      setStages([]);
      setShowChat(false);
      setJidFromUrlState(null);
    }
  }, [location.search]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    if ("addEventListener" in mq) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    return () => {
      if ("removeEventListener" in mq) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, []);

  const [showChat, setShowChat] = useState(false);
  const [openInfinityBot, setOpenInfinityBot] = useState(false);
  const [botClosing, setBotClosing] = useState(false);

  const startCloseInfinityBot = () => {
    setBotClosing(true);
    window.setTimeout(() => {
      setOpenInfinityBot(false);
      setBotClosing(false);
    }, 160);
  };

  const SIDEBAR_WIDTH_STORAGE_KEY = "wa_inbox_sidebar_width";
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const n = raw ? Number(raw) : 450; 
    return Number.isFinite(n) ? Math.min(800, Math.max(340, n)) : 450; 
  });

  const isResizingSidebarRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWRef = useRef(0);

  useEffect(() => { localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth)); }, [sidebarWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizingSidebarRef.current) return;
      const delta = e.clientX - resizeStartXRef.current;
      const next = Math.min(800, Math.max(340, resizeStartWRef.current + delta)); 
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!isResizingSidebarRef.current) return;
      isResizingSidebarRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startResizeSidebar = (e: React.MouseEvent) => {
    isResizingSidebarRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWRef.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const [showSummary, setShowSummary] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [forceShowSummary, setForceShowSummary] = useState(false);

  const { user, hasRole, isManager } = useAuth();
  const isAdmin = hasRole?.("admin") ?? false;
  const companyId = user?.company_id ?? null;

  const [myProfileNome, setMyProfileNome] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const loadMyProfileName = async () => {
      try {
        const uid = (user as any)?.id;
        if (!uid) return;
        const { data, error } = await supabase.from("profiles").select("nome").eq("id", uid).maybeSingle();
        if (!cancelled) {
          if (!error && data?.nome) setMyProfileNome(String(data.nome));
        }
      } catch {}
    };
    void loadMyProfileName();
    return () => { cancelled = true; };
  }, [(user as any)?.id]);

  const mySenderName = useMemo(() => {
    return (
      myProfileNome ||
      (user as any)?.user_metadata?.nome ||
      (user as any)?.user_metadata?.name ||
      (user as any)?.user_metadata?.full_name ||
      (user as any)?.user_metadata?.user_name ||
      "Atendente"
    );
  }, [myProfileNome, user]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [imgZoom, setImgZoom] = useState(1);
  const [imgPos, setImgPos] = useState({ x: 0, y: 0 });
  const [imgDragging, setImgDragging] = useState(false);
  const imgDragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const zoomContainerRef = useRef<HTMLDivElement | null>(null);

  // Reset zoom quando muda de imagem + bloquear scroll de TUDO
  useEffect(() => {
    setImgZoom(1); setImgPos({ x: 0, y: 0 });
    if (zoomImageUrl) {
      const chatEl = scrollAreaRef.current;
      const leadEl = leadListRef.current;

      // Salva posição do scroll antes de bloquear
      const chatScrollTop = chatEl?.scrollTop ?? 0;
      const leadScrollTop = leadEl?.scrollTop ?? 0;

      // Bloqueia scroll dos containers
      if (chatEl) chatEl.style.overflowY = "hidden";
      if (leadEl) leadEl.style.overflowY = "hidden";

      return () => {
        // Restaura overflow E posição do scroll
        if (chatEl) { chatEl.style.overflowY = ""; chatEl.scrollTop = chatScrollTop; }
        if (leadEl) { leadEl.style.overflowY = ""; leadEl.scrollTop = leadScrollTop; }
      };
    }
  }, [zoomImageUrl]);
  const [currentLead, setCurrentLead] = useState<string | null>(null);
  const leadListRef = useRef<HTMLDivElement | null>(null);
  const leadRowRefMap = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const scrollToLeadRef = useRef<string | null>(null);

  useEffect(() => { setOpenInfinityBot(false); }, [currentLead]);

  const [isSwitchingChat, setIsSwitchingChat] = useState(false);
  const [search, setSearch] = useState("");
  const [targetMsgId, setTargetMsgId] = useState<string | null>(null); // NOVO ESTADO AQUI
  const [onlyUnread, setOnlyUnread] = useState<boolean>(false);

  // Busca dentro da conversa aberta
  const [chatSearchOpen, setChatSearchOpen] = useState<boolean>(false);
  const [chatSearchTerm, setChatSearchTerm] = useState<string>("");
  const [chatSearchIndex, setChatSearchIndex] = useState<number>(0);

  // Map { remote_jid: ultima_msg } vindo da RPC get_last_message_per_jid.
  // Usado como fallback no preview da lista quando a mensagem mais recente
  // do lead não está em memória (ex: lead com última conversa antiga).
  const [lastMsgFromDb, setLastMsgFromDb] = useState<Record<string, LastMsgEntry>>({});

  // Modal de envio de template (YCloud)
  const [showSendTemplate, setShowSendTemplate] = useState<boolean>(false);
  const [leadSortOrder, setLeadSortOrder] = useState<"desc" | "asc">(() => {
    try {
      const v = localStorage.getItem("wa_lead_sort_order");
      return v === "asc" || v === "desc" ? v : "desc";
    } catch { return "desc"; }
  });

  useEffect(() => { try { localStorage.setItem("wa_lead_sort_order", leadSortOrder); } catch {} }, [leadSortOrder]);

  const [leadSelectMode, setLeadSelectMode] = useState(false);
  const [selectedLeadJids, setSelectedLeadJids] = useState<Set<string>>(new Set());

  // Scroll para mensagem citada (quoted)
  function scrollToQuotedMessage(waMessageId: string) {
    if (!waMessageId) return;
    // Procurar a mensagem pelo message_id (WhatsApp ID)
    const found = currentMessages.find(m =>
      m.message_id === waMessageId ||
      (m as any)?.raw_payload?.key?.id === waMessageId
    );
    if (found) {
      setTargetMsgId(found.id);
    }
  }

  // NOVO EFEITO DE SCROLL PARA MENSAGEM
  useEffect(() => {
    if (!isSwitchingChat && targetMsgId) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`msg-${targetMsgId}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(() => setTargetMsgId(null), 3000);
        }
      }, 500); 
      return () => clearTimeout(timer);
    }
  }, [isSwitchingChat, targetMsgId, messages.length]);

  const toggleSelectJid = (jid: string) => {
    setSelectedLeadJids((prev) => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedLeadJids(new Set());
    setLeadSelectMode(false);
  };

  const bulkDeleteSelectedJids = async () => {
    if (!companyId) return;
    const jids = Array.from(selectedLeadJids);
    if (jids.length === 0) return;
    
    const ok = window.confirm(`Apagar o histórico de ${jids.length} conversa(s)?\n\nIsso remove o histórico de mensagens, mas mantém os leads no CRM.`);
    if (!ok) return;

    try {
      const { error: convErr } = await supabase.from("wpp_conversations").delete().eq("company_id", companyId).in("remote_jid", jids);
      if (convErr) { console.error("bulkDelete conversations error:", convErr); }
      await supabase.from("leads").update({ last_message_at: null }).eq("company_id", companyId).in("remote_jid", jids);

      if (currentLead && jids.includes(currentLead)) {
        setCurrentLead(null);
        setLeadMeta(null);
        setShowSummary(false);
      }

      setSelectedLeadJids(new Set());
      setLeadSelectMode(false);
      loadLeadsCache();
      loadMessages();
      loadUnreadByConversation();
    } catch (e) {
      console.error("bulkDelete error:", e);
    }
  };

  const [leadListLimit, setLeadListLimit] = useState<number>(60);
  const [messageDateFrom, setMessageDateFrom] = useState<string>("");
  const [messageDateTo, setMessageDateTo] = useState<string>("");
  
  const CHAT_PAGE_SIZE = 30;
  const DB_CHAT_PAGE_SIZE = 60;
  // Quantas mensagens recentes da empresa o inbox carrega upfront.
  // Antes era 1500. Reduzido pq o lastMsgFromDb cobre o preview universal,
  // e o loadOlderMessagesFromDb pagina por conversa quando precisa.
  const INITIAL_MESSAGES_LIMIT = 500;
  const [visibleMsgCount, setVisibleMsgCount] = useState<number>(CHAT_PAGE_SIZE);
  const [isLoadingOlderMsgs, setIsLoadingOlderMsgs] = useState<boolean>(false);
  const [isLoadingOlderDb, setIsLoadingOlderDb] = useState<boolean>(false);
  const [dbExhaustedByJid, setDbExhaustedByJid] = useState<Record<string, boolean>>({});
  
  const [adminUserFilter, setAdminUserFilter] = useState<string>("all");
  const [adminFunnelFilter, setAdminFunnelFilter] = useState<string>("all");
  const [adminStageFilter, setAdminStageFilter] = useState<string>("all");
  const [filterStages, setFilterStages] = useState<FunnelStage[]>([]);
  const [adminOnlyUnassigned, setAdminOnlyUnassigned] = useState<boolean>(false);

  const [leadCache, setLeadCache] = useState<Record<string, any>>({});
  const [leadCacheLoaded, setLeadCacheLoaded] = useState(false);
  const [teamUsers, setTeamUsers] = useState<Array<{ id: string; nome: string; email?: string }>>([]);
  const [text, setText] = useState("");

  const [openEmojiPicker, setOpenEmojiPicker] = useState(false);

  const EMOJI_CATEGORIES = useMemo(() => [
    {
      title: "Recentes & Padrão",
      emojis: ["👍", "❤️", "😂", "😮", "😢", "🙏", "✅", "❌", "📌", "🔥", "🚀"]
    },
    {
      title: "Carinhas & Emoções",
      emojis: [
        "😀", "😃", "😄", "😁", "😅", "🤣", "😊", "😇", "😉", "😌", 
        "😍", "🥰", "😘", "😋", "😜", "🤪", "🧐", "🤓", "😎", "🤩", 
        "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "😣", "😖", 
        "😫", "🥺", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", 
        "🥶", "😱", "😨", "😰", "😓", "🤔", "🤭", "🤫", "🤥", "😶", 
        "😐", "😑", "😬", "🙄", "😴", "🤤", "😪", "😵", "🤐", "🥴", 
        "🤢", "🤮", "🤧", "😷", "🤒", "🤕"
      ]
    },
    {
      title: "Mãos & Gestos",
      emojis: [
        "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", 
        "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👎", 
        "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "✍️", 
        "💅", "🤳", "💪", "🦾"
      ]
    },
    {
      title: "CRM & Negócios",
      emojis: [
        "⛔", "📍", "🔔", "🔕", "⏳", "⌛", "💡", "💼", "📈", "📉", 
        "💰", "💵", "💳", "🧾", "📅", "📆", "🗓️", "📝", "📁", "📂", 
        "📊", "📋", "📞", "☎️", "📱", "💻", "📧", "📫", "💬", "💭", 
        "🎯", "🏆", "🥇", "📎"
      ]
    }
  ], []);

  const insertEmojiAtCursor = (emoji: string) => {
    const el = inputRef.current;
    if (!el) { setText((prev) => prev + emoji); return; }

    const value = el.value ?? "";
    const start = typeof el.selectionStart === "number" ? el.selectionStart : value.length;
    const end = typeof el.selectionEnd === "number" ? el.selectionEnd : value.length;

    const next = value.slice(0, start) + emoji + value.slice(end);
    setText(next);

    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      try { el.setSelectionRange(pos, pos); } catch {}
    });
  };

  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);
  const [mediaCaptionText, setMediaCaptionText] = useState("");
  const [showMediaMenu, setShowMediaMenu] = useState(false);

  // Capturar Ctrl+V com imagem/vídeo do clipboard
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      if (!currentLead) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;

        let type: MediaType | null = null;
        if (file.type.startsWith("image/")) type = "image";
        else if (file.type.startsWith("video/")) type = "video";

        if (type) {
          e.preventDefault();
          const fileName = `clipboard_${Date.now()}.${file.type.split("/")[1] || "png"}`;
          const renamedFile = new File([file], fileName, { type: file.type });
          setPendingMedia((prev) => [...prev, { file: renamedFile, url: URL.createObjectURL(file), type }]);
        }
      }
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [currentLead]);

  const mediaSeqRef = useRef(0);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const [recordingTime, setRecordingTime] = useState<number>(0);
  const recordingIntervalRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);

  const [sendWithEnter, setSendWithEnter] = useState<boolean>(() => {
    return localStorage.getItem("send_with_enter") === "true";
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentLeadRef = useRef<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const scrollAdjustRef = useRef<{ prevHeight: number; prevTop: number } | null>(null);
  const visibleMsgCountRef = useRef<number>(CHAT_PAGE_SIZE);
  const filteredLenRef = useRef<number>(0);
  const isLoadingOlderMsgsRef = useRef<boolean>(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (replyingTo && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [replyingTo]);

  useEffect(() => {
    if (!currentLead) return;
    // Delay to ensure textarea is rendered before focusing
    const t = setTimeout(() => { inputRef.current?.focus(); }, 150);
    return () => clearTimeout(t);
  }, [currentLead, showChat]);

  const [leadMeta, setLeadMeta] = useState<Lead | null>(null);
  const [editingLeadCode, setEditingLeadCode] = useState(false);
  const [leadCodeDraft, setLeadCodeDraft] = useState("");
  const [showLeadInfo, setShowLeadInfo] = useState(false);
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [tagsCatalog, setTagsCatalog] = useState<TagType[]>([]);
  
  const [savingLeadMeta, setSavingLeadMeta] = useState(false);
  const [isClosingDeal, setIsClosingDeal] = useState(false); 
  const [isMerging, setIsMerging] = useState(false);

  /**
   * Mescla dois leads preservando o número ATIVO (o que está recebendo mensagens
   * reais do cliente) e absorvendo o duplicado.
   *
   *   1. Move as mensagens do duplicado → número ativo (suffix-aware via .in())
   *   2. Apaga o lead duplicado (libera FK)
   *   3. Se o ativo não tem nome mas o duplicado tem, herda o nome
   *   4. Atualiza UI: messages, leadCache, lastMsgFromDb, currentLead/leadMeta
   *
   * IMPORTANTE: o sentido é "duplicado → ativo", NUNCA "ativo → duplicado".
   * Isso evita renomear o lead pra um jid que o WhatsApp não usa mais.
   *
   * @param activeLead Lead que tem mensagens reais (o que vai sobreviver)
   * @param oldLead Lead duplicado a ser absorvido (vai ser apagado)
   */
  async function handleMergeLeads(activeLead: any, oldLead: any) {
    if (!companyId) return;

    const keepJid: string = activeLead.remote_jid;
    const absorbJid: string = oldLead.remote_jid;

    if (!keepJid || !absorbJid) {
      alert("Não foi possível identificar os números dos leads.");
      return;
    }
    if (normalizeJid(keepJid) === normalizeJid(absorbJid)) {
      alert("Os leads já compartilham o mesmo número.");
      return;
    }

    const confirm = window.confirm(
      `Confirma a mesclagem?\n\n` +
      `• O número ATIVO (${keepJid}) será mantido — é o que recebe mensagens do cliente\n` +
      `• As mensagens de ${absorbJid} serão movidas para o número ativo\n` +
      `• Configurações (usuário atribuído, tags, funil, briefing) do lead ativo serão preservadas\n` +
      `• O lead duplicado (${absorbJid}) será removido`
    );
    if (!confirm) return;

    setIsMerging(true);
    try {
      // 1) Migra mensagens do duplicado → número ativo (cobre variações com/sem sufixo)
      const absorbCandidates = getRemoteJidCandidates(absorbJid);
      const { error: msgErr } = await supabase
        .from("wpp_conversations")
        .update({ remote_jid: keepJid })
        .in("remote_jid", absorbCandidates)
        .eq("company_id", companyId);
      if (msgErr) throw msgErr;

      // 2) Apaga o lead duplicado
      const { error: dupErr } = await supabase
        .from("leads")
        .delete()
        .eq("id", oldLead.id)
        .eq("company_id", companyId);
      if (dupErr) throw dupErr;

      // 3) Herda o nome do duplicado se o ativo não tiver
      const activeName = (activeLead.lead_name || "").trim();
      const oldName = (oldLead.lead_name || "").trim();
      const inheritedName = !activeName && oldName ? oldName : null;
      if (inheritedName) {
        const { error: nameErr } = await supabase
          .from("leads")
          .update({ lead_name: inheritedName })
          .eq("id", activeLead.id)
          .eq("company_id", companyId);
        if (nameErr) console.warn("Falha ao herdar lead_name:", nameErr);
      }

      // 4) Sincroniza UI

      // 4a) messages: remap de jids absorvidos pro ativo
      setMessages((prev) =>
        prev.map((m) =>
          absorbCandidates.includes(String(m.remote_jid))
            ? { ...m, remote_jid: keepJid }
            : m
        )
      );

      // 4b) leadCache: remove entradas do duplicado, mantém/atualiza ativo
      setLeadCache((prev) => {
        const next = { ...prev };
        for (const cand of absorbCandidates) delete next[cand];
        const baseActive = prev[keepJid] || activeLead;
        next[keepJid] = {
          ...baseActive,
          lead_name: inheritedName ?? baseActive.lead_name,
        };
        return next;
      });

      // 4c) lastMsgFromDb: limpa entradas do duplicado (preview da lista fica correto)
      setLastMsgFromDb((prev) => {
        const next = { ...prev };
        for (const cand of absorbCandidates) delete next[cand];
        return next;
      });

      // 4d) Se o lead aberto era o duplicado (oldLead), troca pra apontar pro ativo
      const currentLeadIsAbsorbed = currentLead && absorbCandidates.includes(currentLead);
      if (currentLeadIsAbsorbed) setCurrentLead(keepJid);

      setLeadMeta((prev: any) => {
        if (!prev) return prev;
        if (prev.id === oldLead.id) {
          // Estava com o duplicado aberto; troca pro ativo (já com nome herdado se for o caso)
          return {
            ...activeLead,
            lead_name: inheritedName ?? activeLead.lead_name,
          };
        }
        if (prev.id === activeLead.id && inheritedName) {
          return { ...prev, lead_name: inheritedName };
        }
        return prev;
      });

      alert("Leads mesclados com sucesso! Mensagens consolidadas no número ativo.");
    } catch (err: any) {
      console.error("Erro ao mesclar leads:", err);
      alert(`Oops! Ocorreu um erro ao tentar mesclar os leads.\n\n${err?.message || err}`);
    } finally {
      setIsMerging(false);
    }
  }

  const [tagFilterId, setTagFilterId] = useState<string>("");
  const [tagFilterJids, setTagFilterJids] = useState<Set<string>>(new Set());
  const [loadingTagFilter, setLoadingTagFilter] = useState<boolean>(false);

  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("");

  const [contextMenu, setContextMenu] = useState<{ open: boolean; x: number; y: number; jid: string | null; }>({ open: false, x: 0, y: 0, jid: null });

  const hiddenStorageKey = useMemo(() => {
    const uid = user?.id || "anon";
    const cid = companyId || "company";
    return `crm:hiddenLeads:${cid}:${uid}`;
  }, [companyId, user?.id]);

  const [showHiddenDialog, setShowHiddenDialog] = useState(false);

  const [hiddenJids, setHiddenJids] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(hiddenStorageKey);
      const arr = raw ? (JSON.parse(raw) as string[]) : [];
      return new Set(arr);
    } catch { return new Set(); }
  });

  useEffect(() => {
    try { localStorage.setItem(hiddenStorageKey, JSON.stringify(Array.from(hiddenJids))); } catch {}
  }, [hiddenJids, hiddenStorageKey]);

  const hideConversationForUser = (jid: string) => {
    if (!jid) return;
    setHiddenJids((prev) => {
      const next = new Set(prev);
      next.add(jid);
      return next;
    });
    if (currentLead === jid) {
      setCurrentLead(null);
      setLeadMeta(null);
      if (isMobile) setShowChat(false);
    }
  };

  const unhideConversationForUser = (jid: string) => {
    if (!jid) return;
    setHiddenJids((prev) => {
      const next = new Set(prev);
      next.delete(jid);
      return next;
    });
  };

  const [activeLeadTags, setActiveLeadTags] = useState<TagType[]>([]);

  useEffect(() => {
    const loadLeadActiveTags = async () => {
      if (!leadMeta?.id) {
        setActiveLeadTags([]);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("lead_tags")
          .select("tag_id")
          .eq("lead_id", leadMeta.id);
          
        if (!error && data) {
          const matchedTags = data
            .map((d: any) => tagsCatalog.find((t) => t.id === d.tag_id))
            .filter(Boolean);
          setActiveLeadTags(matchedTags as TagType[]);
        }
      } catch (e) {
        console.error("Erro tags cabeçalho:", e);
      }
    };
    loadLeadActiveTags();
  }, [leadMeta?.id, tagsCatalog]);

  const [unreadMap, setUnreadMap] = useState<Map<string, { unread_count: number; last_unread_at: string | null }>>(new Map());
  const [unreadLoaded, setUnreadLoaded] = useState<boolean>(false);
  const [pulseMap, setPulseMap] = useState<Map<string, number>>(new Map());

  function scrollToBottom() { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }

  function normalizeJid(jid: string) {
    const raw = String(jid || "").trim().toLowerCase();
    const noSuffix = raw.replace(/@s\.whatsapp\.net$/i, "").replace(/@g\.us$/i, "");
    const digits = noSuffix.replace(/\D/g, "");
    return digits || noSuffix;
  }

  function getRemoteJidCandidates(remoteJid: string) {
    const raw = String(remoteJid || "").trim().toLowerCase();
    const normalized = normalizeJid(raw);
    const noSuffix = raw.replace(/@s\.whatsapp\.net$/i, "").replace(/@g\.us$/i, "");
    const base = normalized || noSuffix || raw;
    const out = new Set<string>();

    if (raw) out.add(raw);
    if (noSuffix) out.add(noSuffix);
    if (base) {
      out.add(base);
      out.add(`${base}@s.whatsapp.net`);
      out.add(`${base}@g.us`);
    }

    return Array.from(out).filter(Boolean);
  }

  function buildConversationKey(remoteJid: string, instanceId?: string | null) {
    const jid = normalizeJid(remoteJid);
    const inst = instanceId ? String(instanceId) : "";
    return `${jid}::${inst}`;
  }

  function bumpLeadLastMessage(remoteJid: string, createdAt?: string | null) {
    const ts = createdAt ? new Date(createdAt).toISOString() : new Date().toISOString();
    const jid = normalizeJid(remoteJid);
    const candidates = Array.from(new Set([remoteJid, jid].filter(Boolean))) as string[];

    setLeadCache((prev) => {
      if (!prev) return prev;
      let changed = false;
      const next = { ...prev };

      for (const k of candidates) {
        const meta = next[k];
        if (!meta) continue;

        const prevTs = meta?.last_message_at ? new Date(meta.last_message_at).getTime() : 0;
        const newTs = new Date(ts).getTime();
        if (newTs >= prevTs) {
          next[k] = { ...meta, last_message_at: ts };
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }

  function isUUID(v: unknown): v is string { return typeof v === "string" && v.length >= 32; }

  function formatTime(sec: number) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const r = String(s % 60).padStart(2, "0");
    return `${m}:${r}`;
  }

  function formatDaySeparatorLabel(dateStr: string) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startD = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((startToday.getTime() - startD.getTime()) / 86400000);
    if (diffDays === 0) return "Hoje";
    if (diffDays === 1) return "Ontem";
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString("pt-BR", {
      day: "numeric",
      month: "long",
      ...(sameYear ? {} : { year: "numeric" as const }),
    });
  }

  function getSelectedInstanceKey(): string | null {
    if (!selectedInstanceId) return null;
    const inst = instancias.find((i) => i.instance_name === selectedInstanceId);
    return inst?.instance_key ?? null;
  }

  function getInstanceForSend(): string | null {
    const primaryCandidate = (leadMeta as any)?.send_instance_key || (currentMessages as any)?.at?.(-1)?.instance_id || null;
    if (primaryCandidate) return String(primaryCandidate);
    const def = instancias.find((i: any) => i.is_default);
    if (def?.instance_key) return String(def.instance_key);
    const sel = getSelectedInstanceKey();
    if (sel) return String(sel);
    const first = instancias?.[0];
    if (first?.instance_key) return String(first.instance_key);
    return null;
  }

  function getConversationInstanceId(remoteJid: string): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.remote_jid === remoteJid && m.instance_id) return m.instance_id;
    }
    const unreadInst = unreadByJid.get(normalizeJid(remoteJid))?.instance_id;
    if (unreadInst) return unreadInst;
    const key = getSelectedInstanceKey();
    if (key) return key;
    return null;
  }

  async function loadUnreadByConversation() {
    setUnreadLoaded(false);
    if (!companyId) { setUnreadMap(new Map()); setUnreadLoaded(true); return; }

    try {
      const map = new Map<string, { unread_count: number; last_unread_at: string | null }>();
      let from = 0;
      const pageSize = 1000;

      while (true) {
        const to = from + pageSize - 1;
        const { data, error } = await supabase
          .from("wpp_conversations")
          .select("remote_jid, instance_id, created_at")
          .eq("company_id", companyId)
          .eq("from_me", false)
          .is("read_at", null)
          .order("created_at", { ascending: true })
          .range(from, to);

        if (error) throw error;

        const rows = data || [];
        for (const row of rows as any[]) {
          const key = buildConversationKey(row.remote_jid, row.instance_id);
          const prev = map.get(key);
          const unread_count = (prev?.unread_count || 0) + 1;
          const last_unread_at = row.created_at ?? prev?.last_unread_at ?? null;
          map.set(key, { unread_count, last_unread_at });
        }

        if (rows.length < pageSize) break;
        from += pageSize;
      }

      setUnreadMap(map);
    } catch (err: any) {
      const msg = String(err?.message || err);
      console.warn("loadUnreadByConversation error:", msg);

      const map = new Map<string, { unread_count: number; last_unread_at: string | null }>();
      for (const m of messages) {
        if (m.from_me) continue;
        if (m.read_at) continue;
        const key = buildConversationKey(m.remote_jid, m.instance_id);
        const prev = map.get(key);
        const unread_count = (prev?.unread_count || 0) + 1;
        const last_unread_at = m.created_at ?? prev?.last_unread_at ?? null;
        map.set(key, { unread_count, last_unread_at });
      }
      setUnreadMap(map);
    } finally {
      setUnreadLoaded(true);
    }
  }

  function schedulePulseForConversation(remoteJid: string, instanceId: string) {
    const key = buildConversationKey(remoteJid, instanceId);
    const until = Date.now() + 15000;
    setPulseMap((prev) => { const next = new Map(prev); next.set(key, until); return next; });
    window.setTimeout(() => {
      setPulseMap((prev) => {
        const next = new Map(prev);
        const current = next.get(key);
        if (current && current <= Date.now()) next.delete(key);
        return next;
      });
    }, 15500);
  }

  async function markConversationAsRead(remoteJid: string) {
    const jid = normalizeJid(remoteJid);
    if (!jid || !companyId) return;

    const candidates = getRemoteJidCandidates(remoteJid);
    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from("wpp_conversations")
      .update({ read_at: nowIso })
      .in("remote_jid", candidates)
      .eq("from_me", false)
      .is("read_at", null)
      .eq("company_id", companyId);

    if (error) {
      console.warn("markConversationAsRead error:", error?.message || error);
      return;
    }

    setMessages((prev) => prev.map((m) => {
      if (m.from_me || m.read_at) return m;
      return normalizeJid(m.remote_jid) === jid ? { ...m, read_at: nowIso } : m;
    }));

    setUnreadMap((prev) => {
      const next = new Map(prev);
      for (const key of Array.from(next.keys())) {
        const [keyJid] = String(key).split("::");
        if (keyJid === jid) next.delete(key);
      }
      return next;
    });

    loadUnreadByConversation();
  }

  async function markConversationAsUnread(remoteJid: string) {
    const jid = normalizeJid(remoteJid);
    if (!jid) return;
    const instanceId = getConversationInstanceId(jid);
    if (!instanceId || !companyId) return;

    try {
      const candidates = getRemoteJidCandidates(remoteJid);
      const { data: lastInbound, error: fetchError } = await supabase
        .from("wpp_conversations")
        .select("id, remote_jid, instance_id, created_at, read_at")
        .in("remote_jid", candidates)
        .eq("instance_id", instanceId)
        .eq("from_me", false)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!lastInbound?.id) return;

      const wasAlreadyUnread = !lastInbound.read_at;

      if (!wasAlreadyUnread) {
        const { error: updateError } = await supabase
          .from("wpp_conversations")
          .update({ read_at: null })
          .eq("id", lastInbound.id)
          .eq("company_id", companyId);

        if (updateError) throw updateError;
      }

      setUnreadMap((prev) => {
        const next = new Map(prev);
        const key = buildConversationKey(lastInbound.remote_jid || jid, lastInbound.instance_id || instanceId);
        const current = next.get(key) || { unread_count: 0, last_unread_at: null };
        const nextCount = wasAlreadyUnread ? Math.max(1, current.unread_count || 0) : (current.unread_count || 0) + 1;
        next.set(key, {
          unread_count: nextCount,
          last_unread_at: current.last_unread_at || lastInbound.created_at || new Date().toISOString(),
        });
        return next;
      });
    } catch (err) {
      console.error("Erro ao marcar como não lida:", err);
    }
  }

  function getReplyPreview(msg: Message) {
    if (msg.message && msg.message.trim()) return msg.message;
    const type = msg.message_type?.toLowerCase();
    if (type?.includes("audio")) return "🎙️ Áudio";
    if (type?.includes("image")) return "📷 Imagem";
    if (type?.includes("video")) return "🎥 Vídeo";
    if (type?.includes("document") || type?.includes("pdf")) return "📄 Documento";
    return "📎 Mensagem";
  }

  function buildMyContext(quoted: Message | null | undefined, contactDisplayName: string, mySenderName: string) {
    if (!quoted) return null;
    const participant = quoted.from_me ? (mySenderName) : (contactDisplayName || "Contato");
    return {
      quoted_message_id: quoted.message_id || quoted.id || null,
      quoted_body: getReplyPreview(quoted),
      quoted_participant: participant,
      quoted_type: quoted.message_type || null,
      quoted_media_url: quoted.media_url || null,
    };
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const leadIdInUrl = params.get("leadId");
    const jidInUrl = params.get("jid");
    if ((!leadIdInUrl && !jidInUrl) || !companyId) return;

    let cancelled = false;
    const openLeadFromUrl = async () => {
      try {
        setIsSwitchingChat(true);

        // Resolve remote_jid. Se veio leadId, busca no banco. Se veio jid legado, usa direto e
        // tenta descobrir o lead.id para fazer upgrade silencioso da URL.
        let resolvedJid: string | null = null;
        let resolvedLeadId: string | null = null;

        if (leadIdInUrl) {
          const { data } = await supabase
            .from("leads")
            .select("id, remote_jid")
            .eq("id", leadIdInUrl)
            .eq("company_id", companyId)
            .maybeSingle();
          if (data) {
            resolvedJid = (data as any).remote_jid;
            resolvedLeadId = (data as any).id;
          }
        } else if (jidInUrl) {
          // O JID na URL pode vir com sufixo (5511...@s.whatsapp.net) ou só dígitos —
          // e o lead pode estar salvo de qualquer das duas formas. Tenta todas as
          // variantes pra evitar abrir um "contato novo" quando o lead já existe.
          resolvedJid = jidInUrl;
          const candidates = getRemoteJidCandidates(jidInUrl);
          const { data } = await supabase
            .from("leads")
            .select("id, remote_jid")
            .eq("company_id", companyId)
            .in("remote_jid", candidates)
            .limit(1)
            .maybeSingle();
          if (data) {
            resolvedJid = (data as any).remote_jid || jidInUrl;
            resolvedLeadId = (data as any).id;
          }
        }

        if (cancelled || !resolvedJid) return;

        setCurrentLead(resolvedJid);
        setJidFromUrlState(resolvedJid);
        scrollToLeadRef.current = resolvedJid;
        if (isMobile) setShowChat(true);
        await ensureConversationLoaded(resolvedJid);
        await loadLeadMeta(resolvedJid);

        // Upgrade silencioso: se a URL veio com ?jid= e descobrimos o lead.id, troca por ?leadId=
        if (!leadIdInUrl && resolvedLeadId) {
          setLeadInUrl(resolvedLeadId, resolvedJid, "replace");
        }
      } catch (err) {
        console.error("Erro ao abrir lead pela URL:", err);
      } finally {
        if (!cancelled) { setIsSwitchingChat(false); }
      }
    };
    openLeadFromUrl();
    return () => { cancelled = true; };
  }, [location.search, companyId, isMobile]);

  useEffect(() => {
    if (!companyId) return;

    setTagsCatalog([]);
    setTagFilterId("");
    setTagFilterJids(new Set());
    setLoadingTagFilter(false);

    loadLeadsCache();
    loadTeamUsers();
    loadMessages();
    loadUnreadByConversation();
    loadFunnels();
    // Carrega previews da última mensagem por conversa (1 query, escala por empresa)
    fetchLastMessagePerJid(companyId).then(setLastMsgFromDb).catch(() => setLastMsgFromDb({}));
    loadTagsCatalog();
    loadInstancias();

    if ("Notification" in window) {
      if (Notification.permission === "default") { Notification.requestPermission(); }
    }

    const channel = supabase
      .channel("wpp-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "wpp_conversations", filter: `company_id=eq.${companyId}` },
        (payload) => {
          const newMsg = payload.new as Message;
          if (!newMsg.company_id || newMsg.company_id !== companyId) return;
          
          setMessages((prev) => {
            const pendingIdx = (() => {
              if (!newMsg.from_me) return -1;
              const winMs = 60_000;
              const isMediaType = (t: any) => ["audio", "image", "video", "document", "media"].includes(String(t || ""));
              
              const cid = (newMsg as any)?.raw_payload?.client_media_id || (newMsg as any)?.raw_payload?.local_client_id || (newMsg as any)?.local_client_id || null;

              if (cid) {
                for (let i = prev.length - 1; i >= 0; i--) {
                  const m = prev[i] as any;
                  if (m?._local_status !== "pending") continue;
                  if (m.remote_jid !== newMsg.remote_jid) continue;
                  const mid = m?._local_client_id || m?.raw_payload?.client_media_id || m?.raw_payload?.local_client_id;
                  if (mid && String(mid) === String(cid)) return i;
                }
              }

              for (let i = prev.length - 1; i >= 0; i--) {
                const m = prev[i] as any;
                if (m?._local_status !== "pending") continue;
                if (m.remote_jid !== newMsg.remote_jid) continue;
                const mtOld = m.message_type || "";
                const mtNew = (newMsg as any).message_type || "";
                if (mtOld !== mtNew && !(isMediaType(mtOld) && isMediaType(mtNew))) continue;

                const a = (m.message || "").trim();
                const b = (newMsg.message || "").trim();
                if (a && b && a !== b) continue;

                const dt = Math.abs(new Date(m.created_at).getTime() - new Date(newMsg.created_at).getTime());
                if (dt > winMs) continue;

                return i;
              }
              return -1;
            })();

            if (pendingIdx >= 0) {
              const next = [...prev];
              const merged = mergePreferNonNull(next[pendingIdx] as any, newMsg as any) as any;
              delete merged._local_status;
              delete merged._local_preview_url;
              next[pendingIdx] = merged;
              return next;
            }

            // Dedupe por ID do banco
            if (newMsg.id && prev.some(m => m.id === newMsg.id)) return prev;

            const key = getMessageDedupKey(newMsg);
            const idx = prev.findIndex((m) => getMessageDedupKey(m) === key);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = mergePreferNonNull(next[idx] as any, newMsg as any) as any;
              return next;
            }

            // Dedupe reações: se já existe reação com mesmo emoji + quoted_message_id, substituir
            if (String(newMsg.message_type || "").includes("reaction")) {
              const newQuoted = String((newMsg as any).context_quoted_message_id || "");
              const newEmoji = String(newMsg.message || "");
              if (newQuoted) {
                const existingIdx = prev.findIndex(m => {
                  if (!String(m.message_type || "").includes("reaction")) return false;
                  const mQuoted = String((m as any).context_quoted_message_id || (m as any).raw_payload?.quoted_message_id || "");
                  return mQuoted === newQuoted && String(m.message || "") === newEmoji && m.from_me === newMsg.from_me;
                });
                if (existingIdx >= 0) {
                  const next = [...prev];
                  next[existingIdx] = newMsg;
                  return next;
                }
              }
            }

            return [...prev, newMsg];
          });
          
          bumpLeadLastMessage(newMsg.remote_jid, (newMsg as any).created_at);
          loadUnreadByConversation();

          // Mantem o preview da lista fresco mesmo p/ conversas nao abertas
          if (!String(newMsg.message_type || "").includes("reaction")) {
            setLastMsgFromDb((prev) => {
              const cur = prev[newMsg.remote_jid];
              if (cur && new Date(cur.created_at).getTime() >= new Date(newMsg.created_at).getTime()) {
                return prev;
              }
              return {
                ...prev,
                [newMsg.remote_jid]: {
                  remote_jid: newMsg.remote_jid,
                  message: (newMsg as any).message ?? null,
                  message_type: (newMsg as any).message_type ?? null,
                  from_me: !!(newMsg as any).from_me,
                  created_at: (newMsg as any).created_at,
                },
              };
            });
          }

          if (!newMsg.from_me && newMsg.remote_jid !== currentLeadRef.current) {
            schedulePulseForConversation(newMsg.remote_jid, newMsg.instance_id);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "wpp_conversations", filter: `company_id=eq.${companyId}` },
        (payload) => {
          const updated = payload.new as Message;
          if (!updated.company_id || updated.company_id !== companyId) return;
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === updated.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = mergePreferNonNull(next[idx] as any, updated as any) as any;
              return next;
            }

            const key = getMessageDedupKey(updated);
            const idx2 = prev.findIndex((m) => getMessageDedupKey(m) === key);
            if (idx2 >= 0) {
              const next = [...prev];
              next[idx2] = mergePreferNonNull(next[idx2] as any, updated as any) as any;
              return next;
            }

            return dedupMessages([...prev, updated]);
          });
          bumpLeadLastMessage(updated.remote_jid, (updated as any).created_at);
          loadUnreadByConversation();
        }
      )
      .subscribe((status) => {
        console.log("[Realtime] wpp-realtime status:", status);
      });

    return () => { supabase.removeChannel(channel); };
  }, [companyId]);

  useEffect(() => { currentLeadRef.current = currentLead; }, [currentLead]);

  useEffect(() => {
    scrollAdjustRef.current = null;
    setIsLoadingOlderMsgs(false);
    setVisibleMsgCount(CHAT_PAGE_SIZE);
  }, [currentLead, messageDateFrom, messageDateTo]);

  useEffect(() => { visibleMsgCountRef.current = visibleMsgCount; }, [visibleMsgCount]);
  useEffect(() => { isLoadingOlderMsgsRef.current = isLoadingOlderMsgs; }, [isLoadingOlderMsgs]);

  useLayoutEffect(() => {
    const el = scrollAreaRef.current;
    const adj = scrollAdjustRef.current;
    if (!el || !adj) return;
    const newHeight = el.scrollHeight;
    const delta = newHeight - adj.prevHeight;
    el.scrollTop = adj.prevTop + (delta > 0 ? delta : 0);
    scrollAdjustRef.current = null;
    setIsLoadingOlderMsgs(false);
  }, [visibleMsgCount]);

  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;

    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollToBottom(distanceFromBottom > 80);

      const lead = currentLeadRef.current;
      const total = filteredLenRef.current;
      const visible = visibleMsgCountRef.current;
      if (!lead) return;
      if (isLoadingOlderMsgsRef.current) return;
      if (visible >= total) return;
      if (el.scrollTop <= 40) {
        scrollAdjustRef.current = { prevHeight: el.scrollHeight, prevTop: el.scrollTop };
        setIsLoadingOlderMsgs(true);
        setVisibleMsgCount((c) => Math.min(c + CHAT_PAGE_SIZE, total));
      }
    };

    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { localStorage.setItem("send_with_enter", String(sendWithEnter)); }, [sendWithEnter]);

  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) { clearInterval(recordingIntervalRef.current); recordingIntervalRef.current = null; }
      if (animationFrameRef.current) { cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null; }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop()); mediaStreamRef.current = null;
      processedStreamRef.current?.getTracks().forEach((t) => t.stop()); processedStreamRef.current = null;
      if (audioContextRef.current) { try { audioContextRef.current.close(); } catch {} audioContextRef.current = null; }
    };
  }, []);

  async function loadMessages() {
    if (!companyId) { setMessages([]); return; }

    const jids = Object.keys(leadCache || {});

    if (!isManager && jids.length === 0) {
      setMessages([]);
      return;
    }

    let data, error;

    if (jids.length > 0) {
      const res = await supabase.rpc('get_conversations_by_jids', {
        p_company_id: companyId,
        p_remote_jids: jids
      });
      data = res.data;
      error = res.error;
    } else {
      const res = await supabase.from("wpp_conversations")
        .select("id,remote_jid,instance_id,company_id,from_me,message,message_type,message_id,media_url,created_at,read_at,raw_payload,assigned_user_id,sent_by_user_id,context_quoted_message_id,wa_sent_at,wa_delivered_at,wa_read_at,transcription,transcription_status,provider")
        .eq("company_id", companyId)
        .not("company_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(INITIAL_MESSAGES_LIMIT);
      data = res.data;
      error = res.error;
    }

    if (error) { console.error("loadMessages error:", error); setMessages([]); return; }

    const messagesInOrder = (data || []).slice(0, INITIAL_MESSAGES_LIMIT).reverse();
    setMessages((prev) => dedupMessages([...prev, ...messagesInOrder]));
  }

  async function fetchMessagesPageForJid(jid: string, beforeCreatedAt?: string | null) {
    if (!companyId) return [] as Message[];
    const normalized = normalizeJid(jid);
    const candidates = Array.from(new Set([jid, normalized].filter(Boolean)));
    let q = supabase.from("wpp_conversations").select("id,remote_jid,instance_id,company_id,from_me,message,message_type,message_id,media_url,created_at,read_at,raw_payload,assigned_user_id,sent_by_user_id,context_quoted_message_id,wa_sent_at,wa_delivered_at,wa_read_at,transcription,transcription_status,provider").eq("company_id", companyId).in("remote_jid", candidates);

    if (beforeCreatedAt) { q = q.lt("created_at", beforeCreatedAt); }

    const { data, error } = await q.order("created_at", { ascending: false }).limit(DB_CHAT_PAGE_SIZE);

    if (error) { console.error("fetchMessagesPageForJid error:", error); return [] as Message[]; }
    return (data || []) as any as Message[];
  }

  async function ensureConversationLoaded(jid: string) {
    const normalized = normalizeJid(jid);
    const hasAny = messages.some((m) => m.remote_jid === jid || m.remote_jid === normalized);
    if (hasAny) return;

    setIsLoadingOlderDb(true);
    try {
      const page = await fetchMessagesPageForJid(jid, null);
      if (!page.length) { setDbExhaustedByJid((prev) => ({ ...prev, [jid]: true })); return; }
      if (page.length < DB_CHAT_PAGE_SIZE) { setDbExhaustedByJid((prev) => ({ ...prev, [jid]: true })); } 
      else { setDbExhaustedByJid((prev) => ({ ...prev, [jid]: false })); }

      const pageInOrder = page.slice().reverse();
      setMessages((prev) => dedupMessages([...prev, ...pageInOrder]));
    } finally {
      setIsLoadingOlderDb(false);
    }
  }

  async function loadOlderMessagesFromDb(jid: string) {
    if (!jid) return;
    if (dbExhaustedByJid[jid]) return;

    const normalized = normalizeJid(jid);
    const current = messages.filter((m) => m.remote_jid === jid || m.remote_jid === normalized);
    const oldest = current.reduce<string | null>((acc, m) => {
      const t = new Date(m.created_at).getTime();
      if (Number.isNaN(t)) return acc;
      if (!acc) return m.created_at;
      const ta = new Date(acc).getTime();
      return t < ta ? m.created_at : acc;
    }, null);

    setIsLoadingOlderDb(true);
    try {
      const page = await fetchMessagesPageForJid(jid, oldest);
      if (!page.length) { setDbExhaustedByJid((prev) => ({ ...prev, [jid]: true })); return; }
      if (page.length < DB_CHAT_PAGE_SIZE) { setDbExhaustedByJid((prev) => ({ ...prev, [jid]: true })); }

      const pageInOrder = page.slice().reverse();
      setMessages((prev) => dedupMessages([...pageInOrder, ...prev]));
    } finally {
      setIsLoadingOlderDb(false);
    }
  }

  async function loadLeadsCache() {
    if (!companyId) return;
    setLeadCacheLoaded(false);

    try {
      const selectFields = "id, remote_jid, number_lead, lead_code, lead_name, assigned_user_id, current_funnel_id, current_stage_id, waiting_since, last_message_at, chat_summary, chat_summary_updated_at";

      const getLeadIdsFromLeadUsers = async (profileId: string) => {
        try {
          let allIds: string[] = [];
          let from = 0;
          const step = 1000;
          
          while (true) {
            const { data, error } = await supabase.from("lead_users")
              .select("lead_id")
              .eq("user_id", profileId)
              .range(from, from + step - 1);
              
            if (error || !data || data.length === 0) break;
            allIds.push(...data.map((r: any) => String(r.lead_id)).filter(Boolean));
            
            if (data.length < step) break; 
            from += step;
          }
          return allIds;
        } catch { return [] as string[]; }
      };

      const buildLeadUsersMap = async (leadIds: string[]) => {
        const map: Record<string, string[]> = {};
        if (!leadIds.length) return map;
        try {
          const idChunks = chunkArray(leadIds, 200); 
          for (const chunk of idChunks) {
            const { data, error } = await supabase.from("lead_users").select("lead_id,user_id").in("lead_id", chunk);
            if (error) continue;
            
            (data || []).forEach((r: any) => {
              const lid = String(r.lead_id);
              const uid = String(r.user_id);
              if (!lid || !uid) return;
              if (!map[lid]) map[lid] = [];
              map[lid].push(uid);
            });
          }
          Object.keys(map).forEach((k) => { map[k] = Array.from(new Set(map[k])); });
          return map;
        } catch { return map; }
      };

      const chunkArray = (arr: any[], size: number) => 
        Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));

      let leadsData: any[] = [];
      const myProfileId = (user as any)?.id as string | undefined;

      let targetUserId: string | null = null;
      let wantUnassigned = false;

      if (isManager && urlUserFilter) targetUserId = urlUserFilter;
      if (isManager && adminUserFilter !== "all") {
        if (adminUserFilter === "unassigned") wantUnassigned = true;
        else targetUserId = adminUserFilter;
      }

      const activeFilterId = isManager ? targetUserId : myProfileId;

      let q1 = supabase.from("leads")
        .select(selectFields)
        .eq("company_id", companyId)
        .not("company_id", "is", null);

      if (activeFilterId && activeFilterId !== "all" && !wantUnassigned) {
          q1 = q1.eq("assigned_user_id", activeFilterId);
      } else if (wantUnassigned) {
          q1 = q1.is("assigned_user_id", null);
      }

      if (isManager && adminFunnelFilter !== "all") {
          q1 = q1.eq("current_funnel_id", adminFunnelFilter);
          if (adminStageFilter !== "all") {
              q1 = q1.eq("current_stage_id", adminStageFilter);
          }
      }

      try {
        let from = 0;
        const step = 1000;
        // Ordem estavel para paginacao (evita chunks duplicados/perdidos)
        q1 = q1.order("id", { ascending: false });
        while (true) {
          const { data, error } = await q1.range(from, from + step - 1);

          if (error) throw error;
          if (!data || data.length === 0) break;

          leadsData = [...leadsData, ...data];

          if (data.length < step) break;
          from += step;
        }
      } catch (errorDirect) {
        console.error("loadLeadsCache exhaustive error:", errorDirect);
      }

      // Dedupe por id (rede de seguranca)
      {
        const seen = new Set<string>();
        leadsData = leadsData.filter((l) => {
          const id = String(l?.id || "");
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
      }

      if (activeFilterId && activeFilterId !== "all" && !wantUnassigned) {
          const leadIds = await getLeadIdsFromLeadUsers(activeFilterId);
          if (leadIds.length > 0) {
              const idChunks = chunkArray(leadIds, 50);
              for (const chunk of idChunks) {
                  let qChunk = supabase.from("leads").select(selectFields)
                      .eq("company_id", companyId)
                      .not("company_id", "is", null)
                      .in("id", chunk);

                  if (isManager && adminFunnelFilter !== "all") {
                      qChunk = qChunk.eq("current_funnel_id", adminFunnelFilter);
                      if (adminStageFilter !== "all") {
                          qChunk = qChunk.eq("current_stage_id", adminStageFilter);
                      }
                  }

                  const { data: dataChunk, error: errChunk } = await qChunk;
                  if (errChunk) { console.error("loadLeadsCache chunk error:", errChunk); }
                  if (dataChunk) {
                      const existingIds = new Set(leadsData.map(l => l.id));
                      const newLeads = dataChunk.filter(l => !existingIds.has(l.id));
                      leadsData = [...leadsData, ...newLeads];
                  }
              }
          }
      }

      const leadIdsAll = leadsData.map((l) => String(l.id)).filter(Boolean);
      const leadUsersMap = await buildLeadUsersMap(leadIdsAll);

      const finalLeads = wantUnassigned
        ? leadsData.filter((l) => !l.assigned_user_id && !(leadUsersMap[String(l.id)] || []).length)
        : leadsData;

      const map: Record<string, any> = {};
      finalLeads.forEach((l: any) => {
        const lid = String(l.id);
        const assigned = Array.from(new Set([...(l.assigned_user_id ? [String(l.assigned_user_id)] : []), ...((leadUsersMap[lid] || []).map(String)),]));
        map[String(l.remote_jid)] = { ...l, assigned_user_ids: assigned, };
      });

      setLeadCache(map);
    } catch (e) {
      console.error("loadLeadsCache error:", e);
      setLeadCache({});
    } finally {
      setLeadCacheLoaded(true);
    }
  }

  useEffect(() => {
    if (!companyId) return;
    if (!leadCacheLoaded) return;
    if (!isManager) {
      if (!Object.keys(leadCache || {}).length) { setMessages([]); return; }
    }
    loadMessages();
  }, [companyId, isAdmin, isManager, leadCacheLoaded, adminUserFilter, adminFunnelFilter, adminStageFilter, urlUserFilter]);

  async function loadTeamUsers() {
    if (!companyId) return; 
    const { data, error } = await supabase.from("profiles").select("id, nome, email").eq("company_id", companyId).order("nome");
    if (error) { console.error("loadTeamUsers error:", error); return; }
    setTeamUsers(data || []);
  }

  async function loadInstancias() {
    if (!companyId) { setInstancias([]); setSelectedInstanceId(""); return; }
    const { data, error } = await supabase.from("instancias").select("instance_name,instance_key,token_id,phone_number,status,company_id,user_id").eq("status", "CONNECTED").eq("company_id", companyId).not("company_id", "is", null);
    if (error) { console.error("loadInstancias error:", error); setInstancias([]); setSelectedInstanceId(""); return; }
    const rows = (data as Instancia[]) || [];
    setInstancias(rows);
    if (!selectedInstanceId && rows.length) {
      const first = rows[0];
      if (first?.instance_key) setSelectedInstanceId(first.instance_key);
    }
  }

  async function loadFunnels() {
    if (!companyId) { setFunnels([]); return; }
    const { data, error } = await supabase.from("funnels").select("id,name,active").eq("company_id", companyId).order("name", { ascending: true });
    if (error) { console.error("loadFunnels error:", error); setFunnels([]); return; }
    setFunnels((data as Funnel[]) || []);
  }

  async function loadStagesForFunnel(funnelId: string) {
    if (!funnelId) { setStages([]); return; }
    const { data, error } = await supabase.from("funnel_stages").select("id,funnel_id,name,stage_order,color,stage_type").eq("funnel_id", funnelId).order("stage_order", { ascending: true });
    if (error) { console.error("loadStagesForFunnel error:", error); setStages([]); return; }
    setStages((data as FunnelStage[]) || []);
  }

  async function loadTagsCatalog() {
    setTagsCatalog([]);
    if (!companyId) return;
    const { data, error } = await supabase.from("tags").select("id, name, color").eq("company_id", companyId).order("name", { ascending: true });
    if (error) { console.error("loadTagsCatalog error:", error); setTagsCatalog([]); } 
    else { setTagsCatalog(data || []); }
  }

  useEffect(() => {
    if (!tagFilterId) { setTagFilterJids(new Set()); return; }
    loadTagFilterJids(tagFilterId);
  }, [tagFilterId]);

  async function loadTagFilterJids(tagId: string) {
    if (!tagId) { setTagFilterJids(new Set()); return; }
    if (!companyId) { setTagFilterJids(new Set()); return; }

    try {
      setLoadingTagFilter(true);
      const { data: pivot, error: pivotErr } = await supabase.from("lead_tags").select("lead_id").eq("tag_id", tagId);
      if (pivotErr) throw pivotErr;

      const leadIds = (pivot || []).map((r: any) => r.lead_id).filter(Boolean);
      if (!leadIds.length) { setTagFilterJids(new Set()); return; }

      const { data: leadsRows, error: leadsErr } = await supabase.from("leads").select("remote_jid").eq("company_id", companyId).not("company_id", "is", null).in("id", leadIds);
      if (leadsErr) throw leadsErr;

      const jidsSet = new Set<string>();
      (leadsRows || []).forEach((r: any) => {
        if (r.remote_jid) {
          jidsSet.add(String(r.remote_jid));
          jidsSet.add(normalizeJid(String(r.remote_jid)));
        }
      });

      setTagFilterJids(jidsSet);
    } catch (e) {
      console.error("loadTagFilterJids error:", e);
      setTagFilterJids(new Set());
    } finally {
      setLoadingTagFilter(false);
    }
  }

  async function loadLeadMeta(remoteJid: string) {
    const jid = normalizeJid(remoteJid);
    if (!jid) { setLeadMeta(null); setStages([]); return; }

    let { data, error } = await supabase.from("leads").select("*").eq("remote_jid", jid).eq("company_id", companyId).maybeSingle();

    if (!data && !error && companyId) {
      console.log("Lead não encontrado, criando automático...");
      const { data: newLead, error: createError } = await supabase.from("leads").insert({ company_id: companyId, sent_by_user_id: (user as any)?.id ?? null, remote_jid: jid, lead_code: jid, }).select("*").single();

      if (!createError && newLead) { data = newLead; } 
      else {
        if (createError.code === '23505') {
           const { data: retryData } = await supabase.from("leads").select("*").eq("remote_jid", jid).maybeSingle();
           data = retryData;
        } else {
           console.error("Erro ao criar lead automático:", createError);
        }
      }
    }

    setLeadMeta((data as Lead) || null);
    if (data?.current_funnel_id) {
      loadStagesForFunnel(data.current_funnel_id);
    } else {
      setStages([]);
    }
    return data;
  }

  const handleChangeInstance = async (newInstanceKey: string) => {
    if (!companyId || !newInstanceKey) return;

    setSelectedInstanceId(newInstanceKey);

    if (leadMeta?.id) {
      setLeadMeta((prev: any) => prev ? { ...prev, send_instance_key: newInstanceKey } : prev);
      
      const jid = leadMeta.remote_jid || currentLead;
      if (jid) {
        setLeadCache((prev: any) => {
          const cur = prev?.[jid] || {};
          return { ...prev, [jid]: { ...cur, send_instance_key: newInstanceKey } };
        });
      }

      try {
        const { error } = await supabase
          .from("leads")
          .update({ send_instance_key: newInstanceKey })
          .eq("id", leadMeta.id)
          .eq("company_id", companyId);

        if (error) throw error;
      } catch (error) {
        console.error("Erro ao alterar a instância de envio no banco:", error);
      }
    }
  };


  useEffect(() => {
    setLeadCodeDraft(leadMeta?.lead_name || leadMeta?.lead_code || "");
    setEditingLeadCode(false);
  }, [leadMeta?.id]);

  useEffect(() => {
    if (!companyId) return;
    if (!isManager) return;
    loadLeadsCache();
  }, [adminUserFilter, adminFunnelFilter, adminStageFilter, urlUserFilter]);

  useEffect(() => {
    setAdminStageFilter("all");
    if (!adminFunnelFilter || adminFunnelFilter === "all") { setFilterStages([]); return; }
    (async () => {
      const { data, error } = await supabase
        .from("funnel_stages")
        .select("id,funnel_id,name,stage_order,color,stage_type")
        .eq("funnel_id", adminFunnelFilter)
        .order("stage_order", { ascending: true });
      if (error) { console.error("load filter stages error:", error); setFilterStages([]); return; }
      setFilterStages((data as FunnelStage[]) || []);
    })();
  }, [adminFunnelFilter]);

const lastMessageByLead = useMemo(() => {
  // 1) Memória local (mensagens carregadas — dão prioridade pq são as mais frescas)
  const acc = messages
    .filter(m => !String(m.message_type || "").includes("reaction"))
    .reduce((map, msg) => {
      const existing = map[msg.remote_jid];
      if (!existing || new Date(msg.created_at).getTime() > new Date(existing.created_at).getTime()) {
        map[msg.remote_jid] = msg;
      }
      return map;
    }, {} as Record<string, Message>);

  // 2) Fallback do DB pro preview universal — só preenche jids que NÃO têm mensagem local
  for (const [jid, last] of Object.entries(lastMsgFromDb)) {
    if (!acc[jid]) {
      acc[jid] = {
        id: `lastmsg-${jid}`,
        remote_jid: jid,
        message: last.message,
        message_type: last.message_type,
        from_me: last.from_me,
        created_at: last.created_at,
        // campos não usados no preview, mas precisos pro tipo Message
        company_id: companyId || "",
        instance_id: null,
        message_id: null,
        media_url: null,
        read_at: null,
        raw_payload: null,
      } as any;
    }
  }
  return acc;
}, [messages, lastMsgFromDb, companyId]);

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

      if (!prev) { takeV = true; } 
      else if (vCount > prevCount) { takeV = true; } 
      else if (vCount === prevCount) {
        if (vLast && !prevLast) takeV = true;
        else if (vLast && prevLast) {
          const tPrev = new Date(prevLast).getTime();
          const tCand = new Date(vLast).getTime();
          if (tCand > tPrev) takeV = true;
        }
      }

      if (takeV) {
        map.set(jid, { unread_count: vCount, last_unread_at: vLast, instance_id: instance_id || prev?.instance_id || null, });
      } else {
        if (!prevLast && vLast) { map.set(jid, { ...prev!, last_unread_at: vLast }); }
      }
    });

    return map;
  }, [unreadMap]);

  // Garante que leads com mensagens não lidas apareçam no cache
  useEffect(() => {
    if (!companyId || !leadCacheLoaded || !unreadByJid.size) return;
    const missingJids: string[] = [];
    unreadByJid.forEach((_, jid) => {
      if (!leadCache[jid]) missingJids.push(jid);
    });
    if (!missingJids.length) return;

    const selectFields = "id, remote_jid, number_lead, lead_code, lead_name, assigned_user_id, current_funnel_id, current_stage_id, waiting_since, last_message_at, chat_summary, chat_summary_updated_at";

    (async () => {
      const chunkSize = 50;
      for (let i = 0; i < missingJids.length; i += chunkSize) {
        const chunk = missingJids.slice(i, i + chunkSize);
        const { data } = await supabase.from("leads").select(selectFields).eq("company_id", companyId).in("remote_jid", chunk);
        if (data?.length) {
          setLeadCache((prev: any) => {
            const next = { ...prev };
            data.forEach((l: any) => { if (!next[l.remote_jid]) next[l.remote_jid] = l; });
            return next;
          });
        }
      }
    })();
  }, [companyId, leadCacheLoaded, unreadByJid]);

  // Detecta duplicado pelo 9º dígito e identifica qual é o lead ativo (que mandou msg)
  const duplicateLeadSuggestion = useMemo<{ activeLead: any; oldLead: any; isCurrentActive: boolean } | null>(() => {
    if (!isAdmin && !isManager) return null;
    if (!currentLead || !leadMeta || !leadCacheLoaded) return null;

    const currentJid = currentLead.replace(/@s\.whatsapp\.net$/i, "").replace(/@g\.us$/i, "");
    const base = currentJid.replace(/\D/g, "");

    if (!base.startsWith("55") || base.length < 12) return null;

    let variantBase = "";
    if (base.length === 13 && base[4] === "9") {
      variantBase = base.slice(0, 4) + base.slice(5);
    } else if (base.length === 12) {
      variantBase = base.slice(0, 4) + "9" + base.slice(4);
    }

    if (!variantBase) return null;

    const possibleKeys = [variantBase, `${variantBase}@s.whatsapp.net`];
    let duplicateLead: any = null;

    for (const key of possibleKeys) {
      const dup = leadCache[key];
      if (dup && dup.id !== leadMeta.id) { duplicateLead = dup; break; }
    }

    if (!duplicateLead) return null;

    // O lead ativo é o que tem a última mensagem recebida mais recente (from_me = false)
    const currentLastReceived = messages
      .filter(m => m.remote_jid === currentLead && !m.from_me)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    const dupJid = duplicateLead.remote_jid;
    const dupLastReceived = messages
      .filter(m => m.remote_jid === dupJid && !m.from_me)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    const currentTime = currentLastReceived ? new Date(currentLastReceived.created_at).getTime() : 0;
    const dupTime = dupLastReceived ? new Date(dupLastReceived.created_at).getTime() : 0;

    // O lead ativo é o que recebeu mensagem mais recentemente
    const isCurrentActive = currentTime >= dupTime;

    return {
      activeLead: isCurrentActive ? leadMeta : duplicateLead,
      oldLead: isCurrentActive ? duplicateLead : leadMeta,
      isCurrentActive,
    };
  }, [isAdmin, isManager, currentLead, leadMeta, leadCache, leadCacheLoaded, messages]);

  const myUserId = (user as any)?.id;

  const orderedLeads = useMemo(() => {
    const removeAccents = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const q = removeAccents((search || "").trim().toLowerCase());
    const entries = Object.entries(leadCache || {}) as Array<[string, any]>;

    return entries
      .filter(([jid]) => {
        if (!isAdmin && !leadCacheLoaded) return false;
        return Boolean(jid);
      })
      .filter(([jid]) => {
        if (isAdmin) return true;
        return !hiddenJids.has(jid);
      })
      .filter(([jid, meta]) => {
        const hasLocalMessages = Boolean(lastMessageByLead[jid]);
        const hasDbMessages = Boolean(meta?.last_message_at);
        const isCurrentLead = jid === currentLead;
        const isSearching = Boolean(q);
        const hasUnread = (unreadByJid.get(normalizeJid(jid))?.unread_count || 0) > 0;

        return hasLocalMessages || hasDbMessages || isCurrentLead || isSearching || hasUnread;
      })
      .filter(([jid, meta]) => {
        const uids = Array.isArray(meta?.assigned_user_ids) ? meta.assigned_user_ids : (meta?.assigned_user_id ? [String(meta.assigned_user_id)] : []);
        
        if (!isManager) {
          if (!myUserId) return false;
          return uids.includes(myUserId) || String(meta?.assigned_user_id) === myUserId;
        }

        const targetFilter = urlUserFilter || adminUserFilter;
        if (targetFilter === "all") return true;
        if (targetFilter === "unassigned") {
           return uids.length === 0 && !meta?.assigned_user_id;
        }
        return uids.includes(targetFilter) || String(meta?.assigned_user_id) === targetFilter;
      })
      .filter(([jid, meta]) => {
        if (isManager && adminFunnelFilter !== "all") {
          if (meta?.current_funnel_id !== adminFunnelFilter) return false;
          if (adminStageFilter !== "all" && meta?.current_stage_id !== adminStageFilter) return false;
        }
        return true;
      })
      .filter(([jid]) => {
        if (showLite && showApi) return true;
        if (!showLite && !showApi) return false;
        const last = lastMessageByLead[jid] as any;
        const prov = last?.provider || "evolution";
        return showApi ? prov === "ycloud" : prov === "evolution";
      })
      .filter(([jid, meta]) => {
        if (!q) return true;
        
        // 1. Prepara os dados do lead
        const number = String(meta?.number_lead ?? meta?.numberLead ?? meta?.number ?? "").toLowerCase();
        const rawLeadCode = String(meta?.lead_name ?? meta?.lead_code ?? "").toLowerCase();
        const leadCode = removeAccents(rawLeadCode);
        const rjid = String(jid || "").toLowerCase();

        // 2. Verifica se a busca bate com os dados do lead (Nome, Número, etc)
        const matchLead = number.includes(q) || leadCode.includes(q) || rjid.includes(q);
        if (matchLead) return true;

        // 3. Verifica se a busca bate com alguma mensagem dentro da conversa desse lead
        const matchMessage = messages.some((m) => {
          // Garante que estamos olhando só as mensagens desse contato específico
          const isSameJid = m.remote_jid === jid || normalizeJid(m.remote_jid) === normalizeJid(jid);
          if (!isSameJid) return false;

          // Limpa a mensagem (tira acentos e joga pra minúsculo) e compara
          const msgText = removeAccents(String(m.message || "").toLowerCase());
          return msgText.includes(q);
        });

        return matchMessage;
      })
      .filter(([jid]) => {
        if (!tagFilterId) return true;
        return tagFilterJids.has(jid) || tagFilterJids.has(normalizeJid(jid));
      })
      .filter(([jid]) => {
        if (!onlyUnread) return true;
        const unread = unreadByJid.get(normalizeJid(jid))?.unread_count || 0;
        return unread > 0;
      })
.sort(([jidA, metaA], [jidB, metaB]) => {
  const aMsg = lastMessageByLead[jidA];
  const bMsg = lastMessageByLead[jidB];

  const ta =
    (aMsg?.created_at ? new Date(aMsg.created_at).getTime() : 0) ||
    (metaA?.last_message_at ? new Date(metaA.last_message_at).getTime() : 0) ||
    (metaA?.waiting_since ? new Date(metaA.waiting_since).getTime() : 0);

  const tb =
    (bMsg?.created_at ? new Date(bMsg.created_at).getTime() : 0) ||
    (metaB?.last_message_at ? new Date(metaB.last_message_at).getTime() : 0) ||
    (metaB?.waiting_since ? new Date(metaB.waiting_since).getTime() : 0);

  return leadSortOrder === "asc" ? ta - tb : tb - ta;
})
      .map(([jid, meta]) => {
        let displayMsg = lastMessageByLead[jid];

        // Se houver uma pesquisa (q), tentamos achar a mensagem exata para exibir no preview
        if (q) {
          const matchedMessages = messages.filter((m) => {
            const isSameJid = m.remote_jid === jid || normalizeJid(m.remote_jid) === normalizeJid(jid);
            if (!isSameJid) return false;
            
            const msgText = removeAccents(String(m.message || "").toLowerCase());
            return msgText.includes(q);
          });

          // Se achou mensagens com o termo, usamos a mais recente que deu match
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
    companyId, leadCache, leadCacheLoaded, isAdmin, hiddenJids, search, tagFilterId,
    tagFilterJids, onlyUnread, unreadByJid, lastMessageByLead, leadSortOrder,
    adminUserFilter, urlUserFilter, adminFunnelFilter, adminStageFilter, myUserId,
    showLite, showApi
  ]);

  useEffect(() => {
    if (!currentLead) return;
    const idx = orderedLeads.findIndex((l) => l.remote_jid === currentLead);
    if (idx >= 0 && idx + 1 > leadListLimit) { 
      setLeadListLimit((prev) => Math.max(prev, idx + 20)); 
    }
  }, [currentLead, orderedLeads, leadListLimit]);

  useEffect(() => {
    if (!currentLead) return;
    
    if (scrollToLeadRef.current !== currentLead) return;

    const timer = setTimeout(() => {
      const el = leadRowRefMap.current.get(currentLead);
      if (el) { 
        el.scrollIntoView({ block: "center", behavior: "smooth" }); 
        scrollToLeadRef.current = null;
      }
    }, 150); 

    return () => clearTimeout(timer);
  }, [currentLead, orderedLeads]); 

  const currentMessages = useMemo(() => {
  const currentLeadNorm = currentLead ? normalizeJid(currentLead) : "";
  const arr = currentLead
    ? messages.filter((m) => normalizeJid(String((m as any)?.remote_jid || "")) === currentLeadNorm)
    : [];

  const reactions = arr.filter(m => 
    String(m.message_type || "").toLowerCase().includes("reaction")
  );
  const actualMessages = arr.filter(m => 
    !String(m.message_type || "").toLowerCase().includes("reaction")
  );

  const merged = actualMessages.map(m => {
    const targetWaId = String(m.message_id || "");
    
    const msgReactions = reactions.filter(r => {
      const quotedId = String(
        (r as any).context_quoted_message_id ||
        (r as any).quoted_message_id ||
        (r as any).raw_payload?.reactionMessage?.key?.id ||
        (r as any).raw_payload?.quoted_message_id ||
        ""
      );
      return quotedId && targetWaId && quotedId.trim() === targetWaId.trim();
    });
    
    return {
      ...m,
      reactions_data: msgReactions.map(r => ({
        emoji: r.message || (r as any).raw_payload?.reaction || "❤️",
        from_me: r.from_me
      }))
    };
  });

  return __dedupRenderMessages(merged);
}, [currentLead, messages]);

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

  // Matches da busca dentro da conversa
  const chatSearchMatches = useMemo(() => {
    const q = chatSearchTerm.trim().toLowerCase();
    if (!q || !filteredCurrentMessages.length) return [] as Array<{ id: string; idx: number }>;
    const removeAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    const qNorm = removeAccents(q);
    const out: Array<{ id: string; idx: number }> = [];
    filteredCurrentMessages.forEach((m, idx) => {
      const text = removeAccents(String(m.message || "").toLowerCase());
      if (text && text.includes(qNorm)) {
        out.push({ id: String(m.id), idx });
      }
    });
    return out;
  }, [filteredCurrentMessages, chatSearchTerm]);

  // Reset COMPLETO da busca quando troca de conversa
  // (não persiste termo/índice/estado aberto entre leads diferentes)
  useEffect(() => {
    setChatSearchOpen(false);
    setChatSearchTerm("");
    setChatSearchIndex(0);
  }, [currentLead]);

  // Ao fechar a busca manualmente, limpa termo e índice
  useEffect(() => {
    if (!chatSearchOpen) {
      setChatSearchTerm("");
      setChatSearchIndex(0);
    }
  }, [chatSearchOpen]);

  // Termo mudou: volta pro primeiro match
  useEffect(() => { setChatSearchIndex(0); }, [chatSearchTerm]);

  // Busca a conversa INTEIRA no DB (não precisa carregar mais antigas).
  // Quando o termo muda, faz ilike no Supabase e mescla os matches em `messages`.
  // O highlight/scroll/expansão de visibleMsgCount já existem e cuidam do resto.
  const [chatSearchLoadingDb, setChatSearchLoadingDb] = useState<boolean>(false);
  useEffect(() => {
    if (!chatSearchOpen) return;
    if (!currentLead || !companyId) return;
    const q = chatSearchTerm.trim();
    if (q.length < 2) return; // evita disparar busca a cada letra única

    let alive = true;
    setChatSearchLoadingDb(true);
    const handle = setTimeout(async () => {
      try {
        const safe = q.replace(/[\\%_]/g, "\\$&"); // escapa wildcards do ilike
        const { data, error } = await supabase
          .from("wpp_conversations")
          .select("id,remote_jid,instance_id,company_id,from_me,message,message_type,message_id,media_url,created_at,read_at,raw_payload,assigned_user_id,sent_by_user_id,context_quoted_message_id,wa_sent_at,wa_delivered_at,wa_read_at,transcription,transcription_status,provider")
          .eq("company_id", companyId)
          .eq("remote_jid", currentLead)
          .ilike("message", `%${safe}%`)
          .order("created_at", { ascending: true })
          .limit(500);
        if (!alive) return;
        if (error) { console.error("chat search DB error:", error); return; }
        if (data && data.length) {
          setMessages((prev) => {
            const merged = dedupMessages([...(data as any), ...prev]);
            return merged.sort((a: any, b: any) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          });
        }
      } catch (e) {
        if (alive) console.error("chat search exception:", e);
      } finally {
        if (alive) setChatSearchLoadingDb(false);
      }
    }, 350);

    return () => { alive = false; clearTimeout(handle); setChatSearchLoadingDb(false); };
  }, [chatSearchOpen, currentLead, companyId, chatSearchTerm]);

  // Pula pra mensagem do match atual (highlight + scroll via targetMsgId)
  useEffect(() => {
    if (!chatSearchMatches.length) return;
    const safe = Math.max(0, Math.min(chatSearchIndex, chatSearchMatches.length - 1));
    const match = chatSearchMatches[safe];
    if (!match) return;
    // Garante que a mensagem está renderizada (expande visibleMsgCount se for antiga)
    const distFromEnd = filteredCurrentMessages.length - 1 - match.idx;
    if (distFromEnd >= visibleMsgCount) {
      setVisibleMsgCount(Math.min(filteredCurrentMessages.length, distFromEnd + 5));
    }
    setTargetMsgId(match.id);
  }, [chatSearchIndex, chatSearchMatches, filteredCurrentMessages.length, visibleMsgCount]);

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
            result.push({
              isGroup: true,
              id: `group-${tempImages[0].id}`,
              from_me: msg.from_me,
              created_at: tempImages[tempImages.length - 1].created_at,
              messages: tempImages,
            });
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

  const canLoadMoreLocal = visibleMsgCount < filteredCurrentMessages.length;
  const canLoadMoreFromDb = Boolean(currentLead) && !dbExhaustedByJid[currentLead] && currentMessages.length > 0;
  const canLoadMoreMsgs = canLoadMoreLocal || canLoadMoreFromDb;

  useEffect(() => { filteredLenRef.current = filteredCurrentMessages.length; }, [filteredCurrentMessages.length]);

  const renderedMessages = useMemo(() => {
    return groupedCurrentMessages.map((item: any, index: number) => {
      const msg = item.isGroup ? item.messages[0] : item;
      
      const currD = new Date(item.created_at);
      const currKey = Number.isNaN(currD.getTime()) ? String(item.created_at).slice(0, 10) : currD.toISOString().slice(0, 10);
      const prev = index > 0 ? groupedCurrentMessages[index - 1] : null;
      const prevD = prev ? new Date(prev.created_at) : null;
      const prevKey = prevD && !Number.isNaN(prevD.getTime()) ? prevD.toISOString().slice(0, 10) : prev ? String(prev.created_at).slice(0, 10) : "";
      const dayLabel = formatDaySeparatorLabel(item.created_at);
      const showDaySeparator = Boolean(dayLabel) && (index === 0 || currKey !== prevKey);

      return (
        <div key={item.id || index}>
          {showDaySeparator && (
            <div className="flex justify-center my-2">
              <span className="text-[11px] px-3 py-1 rounded-full bg-muted text-muted-foreground">
                {dayLabel}
              </span>
            </div>
          )}
          <div 
            id={`msg-${msg.id}`} 
            className={`flex group mb-4 ${msg.from_me ? "justify-end" : "justify-start"} ${targetMsgId === msg.id ? "ring-2 ring-primary rounded-xl animate-pulse" : ""}`}
          >
            {msg.from_me && (
  <div className="flex items-center gap-1 self-center opacity-0 group-hover:opacity-100 transition-opacity mr-2">
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setForwardingMessage(msg)} title="Encaminhar">
      <Forward className="h-4 w-4 text-muted-foreground" />
    </Button>
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Reagir">
          <Smile className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-fit p-2 grid grid-cols-6 gap-1 bg-background border shadow-xl rounded-xl">
        {[
          "👍", "❤️", "😂", "😮", "😢", "🙏", 
          "👏", "🔥", "✅", "❌", "👀", "💯", 
          "🎉", "💡", "🚀", "💰", "🤝", "👎"
        ].map((emoji) => (
          <button 
            key={emoji} 
            type="button"
            onClick={() => { sendReaction(msg, emoji); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }}
            className="hover:bg-muted p-2 rounded text-[20px] transition-transform hover:scale-125 flex items-center justify-center"
          >
            {emoji}
          </button>
        ))}
      </PopoverContent>
    </Popover>

    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setReplyingTo(msg); }} title="Responder">
      <CornerUpLeft className="h-4 w-4 text-muted-foreground" />
    </Button>
  </div>
)}

            {msg.from_me ? (
              <div className="flex flex-col items-end max-w-[min(92%,calc(100%-1rem))] min-w-0">
                <div className="text-[10px] mb-1 opacity-60 text-right select-none">
                  {(() => {
                    const role = (msg as any).raw_payload?.sent_by_role;
                    const name = (msg as any).raw_payload?.sent_by_name;
                    const uid = (msg as any).sent_by_user_id || (msg as any).raw_payload?.sent_by_user_id || null;
                    const u = uid ? teamUsers.find((t) => t.id === uid) : null;
                    const derivedName = name || (u as any)?.nome || "";
                    const derivedRole = role || ((uid && (user as any)?.id === uid && isAdmin) ? "admin" : "");

                    if (derivedRole === "admin") { return `Administrador – ${derivedName || "Admin"}`; }
                    if (derivedName) return derivedName;
                    return "Atendente";
                  })()}
                </div>

                <div className={`max-w-full min-w-0 p-1.5 rounded-2xl shadow-md relative break-words [word-break:break-word] [overflow-wrap:anywhere] bg-neutral-600 dark:bg-neutral-500 text-white/95`}>
                  <RenderQuotedMessage msg={msg} currentLeadName={leadMeta?.lead_name || leadMeta?.lead_code || currentLead || "Cliente"} resolveQuotedById={resolveQuotedById} onScrollToMessage={scrollToQuotedMessage} />
                  <MessageReactions msg={msg} />
                  {item.isGroup ? (
                    <div className="grid grid-cols-2 gap-1 rounded-xl overflow-hidden mt-1">
                      {item.messages.map((imgMsg: Message) => {
                        const mediaSrc = imgMsg.media_url || imgMsg._local_preview_url || "";
                        return (
                          <img
                            key={imgMsg.id}
                            src={mediaSrc}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-32 md:h-40 object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                            onClick={() => setZoomImageUrl(mediaSrc)}
                            alt="Mídia enviada"
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-3 pt-2 pb-1 w-full min-w-0">{renderMessageBody(msg)}</div>
                  )}

                  <div className={`flex justify-end items-center gap-1 mt-1 mb-1 mr-2 text-xs text-white/70`}>
                  {new Date(item.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  {renderAck(msg)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-start max-w-[min(92%,calc(100%-1rem))] min-w-0">
                <div className={`max-w-full min-w-0 p-1.5 rounded-2xl shadow-md relative break-words [word-break:break-word] [overflow-wrap:anywhere] bg-muted text-foreground`}>
                  <RenderQuotedMessage msg={msg} currentLeadName={leadMeta?.lead_name || leadMeta?.lead_code || currentLead || "Cliente"} resolveQuotedById={resolveQuotedById} onScrollToMessage={scrollToQuotedMessage} />
                  <MessageReactions msg={msg} />
                  {item.isGroup ? (
                    <div className="grid grid-cols-2 gap-1 rounded-xl overflow-hidden mt-1">
                      {item.messages.map((imgMsg: Message) => {
                        const mediaSrc = imgMsg.media_url || imgMsg._local_preview_url || "";
                        return (
                          <img
                            key={imgMsg.id}
                            src={mediaSrc}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-32 md:h-40 object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                            onClick={() => setZoomImageUrl(mediaSrc)}
                            alt="Mídia recebida"
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-3 pt-2 pb-1 w-full min-w-0">{renderMessageBody(msg)}</div>
                  )}

                  <div className={`flex justify-end items-center gap-1 mt-1 mb-1 mr-2 text-xs text-muted-foreground`}>
                   {new Date(item.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                   {renderAck(msg)}
                  </div>
                </div>
              </div>
            )}

            {!msg.from_me && (
  <div className="flex items-center gap-1 self-center opacity-0 group-hover:opacity-100 transition-opacity ml-2">
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setForwardingMessage(msg)} title="Encaminhar">
      <Forward className="h-4 w-4 text-muted-foreground" />
    </Button>
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setReplyingTo(msg)} title="Responder">
      <CornerUpLeft className="h-4 w-4 text-muted-foreground" />
    </Button>

    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Reagir">
          <Smile className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-fit p-2 grid grid-cols-6 gap-1 bg-background border shadow-xl rounded-xl">
        {[
          "👍", "❤️", "😂", "😮", "😢", "🙏", 
          "👏", "🔥", "✅", "❌", "👀", "💯", 
          "🎉", "💡", "🚀", "💰", "🤝", "👎"
        ].map((emoji) => (
          <button 
            key={emoji} 
            type="button"
            onClick={() => { sendReaction(msg, emoji); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }}
            className="hover:bg-muted p-2 rounded text-[20px] transition-transform hover:scale-125 flex items-center justify-center"
          >
            {emoji}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  </div>
)}
          </div>
        </div>
      );
    });
  }, [groupedCurrentMessages, leadMeta, currentLead, targetMsgId]);

  useEffect(() => {
    if (!currentLead) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentMessages.length]);

  async function requestTranscription(messageId: string) {
    try {
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, transcription_status: "pending" } : m));
      await fetch("https://conversia-n8n.njuzo4.easypanel.host/webhook/transcribe-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
    } catch (err) {
      console.error(err);
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, transcription_status: "error" } : m));
    }
  }

  function escapeHtml(str: string) { return str.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

  function buildSummaryHtml(params: { leadDisplay: string; remoteJid: string; generatedAt: string; summaryText: string; }) {
    const safeSummary = escapeHtml(params.summaryText).replaceAll("\n", "<br/>");
    const safeLead = escapeHtml(params.leadDisplay);
    const safeJid = escapeHtml(params.remoteJid);
    const safeAt = escapeHtml(params.generatedAt);

    return `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Resumo da conversa — ${safeLead}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 0; background:#0b0f14; color:#e5e7eb; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 24px; }
  .card { background:#111827; border:1px solid rgba(255,255,255,.08); border-radius: 14px; padding: 18px; }
  .title { font-size: 18px; font-weight: 700; margin: 0 0 6px; }
  .meta { font-size: 12px; opacity:.75; margin: 0 0 14px; }
  .summary { line-height: 1.55; font-size: 14px; }
  .badge { display:inline-block; font-size:11px; padding: 3px 8px; border-radius:999px; background: rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.10); margin-right: 8px;}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="title">Resumo da conversa</div>
      <div class="meta">
        <span class="badge">${safeAt}</span>
        <span class="badge">${safeJid}</span>
      </div>
      <div class="summary">${safeSummary}</div>
    </div>
  </div>
</body>
</html>`;
  }

  async function requestConversationSummary(): Promise<string | null> {
    if (!currentLead || !companyId) return null;
    const instanceId = getConversationInstanceId(currentLead);

    setIsGeneratingSummary(true);
    setShowSummary(true);
    setLeadMeta((prev) => (prev ? { ...prev, chat_summary: null } : prev));

    try {
      const fallbackInstanceIdForSend = instancias.find((i) => i.is_default)?.instance_key ?? null;
      const { loadSummaryPrompt } = await import("@/components/InfinityBotSummaryPanel");
      const summaryPrompt = await loadSummaryPrompt(companyId);
      const response = await fetch("https://conversia-n8n.njuzo4.easypanel.host/webhook/resumocrm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          instance_id: instanceId || fallbackInstanceIdForSend || "",
          remote_jid: currentLead,
          ...(summaryPrompt ? { summary_prompt: summaryPrompt } : {}),
        }),
      });

      if (!response.ok) return null;

      let urlFromResponse: string | null = null;
      try {
        const json = await response.json();
        const maybe = (json?.url_resumo || json?.url || json?.chat_summary || "") as string;
        urlFromResponse = (maybe || "").trim() || null;
      } catch { urlFromResponse = null; }

      if (urlFromResponse) {
        setLeadMeta((prev) => (prev ? { ...prev, chat_summary: urlFromResponse } : prev));
        setShowSummary(true);
        localStorage.removeItem(`summary_closed_${currentLead}`);
        return urlFromResponse;
      }

      const url = await new Promise<string | null>((resolve) => {
        let attempts = 0;
        const maxAttempts = 120;

        const poll = async () => {
          attempts += 1;
          try {
            const meta = await loadLeadMeta(currentLead);
            const maybeUrl = (meta?.chat_summary || "").trim();
            if (maybeUrl) {
              setShowSummary(true);
              localStorage.removeItem(`summary_closed_${currentLead}`);
              resolve(maybeUrl);
              return;
            }
          } catch (e) { console.error("summary polling error:", e); }

          if (attempts >= maxAttempts) { resolve(null); return; }
          setTimeout(poll, 1000);
        };
        poll();
      });

      return url;
    } catch (err) {
      console.error(err);
      return null;
    } finally {
      setIsGeneratingSummary(false);
    }
  }

  async function generateSummaryHtml() {
    if (!currentLead || !companyId) return null;

    const meta = await loadLeadMeta(currentLead);
    const summaryText = meta?.chat_summary || "";
    if (!summaryText) return;

    const generatedAt = new Date().toISOString();
    const leadDisplay = meta?.lead_name || meta?.lead_code || meta?.number_lead || currentLead;
    const html = buildSummaryHtml({ leadDisplay, remoteJid: currentLead, generatedAt, summaryText, });
    const fileName = `summary_${companyId}_${currentLead}_${Date.now()}.html`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });

    const { error: upErr } = await supabase.storage.from("chat_summaries").upload(fileName, blob, { upsert: true, contentType: "text/html" });
    if (upErr) { console.error("Storage upload summary html error:", upErr); return; }

    const { data: pub } = supabase.storage.from("chat_summaries").getPublicUrl(fileName);
    const url = pub?.publicUrl || "";
    if (!url) return;

    const { error: updErr } = await supabase.from("leads").update({ chat_summary_html_url: url, chat_summary_html_updated_at: new Date().toISOString(), }).eq("company_id", companyId).eq("remote_jid", normalizeJid(currentLead));

    if (updErr) { console.error("Leads update summary url error:", updErr); } 
    else {
      setLeadMeta((prev: any) => prev ? { ...prev, chat_summary_html_url: url, chat_summary_html_updated_at: new Date().toISOString(), } : prev );
    }
  }

  async function updateLeadFunnel(funnelId: string | null) {
    if (!leadMeta?.id) return;
    setSavingLeadMeta(true);
    try {
      const { error } = await supabase.from("leads").update({ current_funnel_id: funnelId, current_stage_id: null, }).eq("id", leadMeta.id);
      if (error) throw error;
      setLeadMeta((prev) => prev ? { ...prev, current_funnel_id: funnelId, current_stage_id: null } : prev );
      
      const jid = leadMeta.remote_jid || currentLead;
      if (jid) {
        setLeadCache((prev: any) => {
          const cur = prev?.[jid] || {};
          return { ...prev, [jid]: { ...cur, current_funnel_id: funnelId, current_stage_id: null } };
        });
      }

      if (funnelId) await loadStagesForFunnel(funnelId);
      else setStages([]);
    } catch (e) {
      console.error("updateLeadFunnel error:", e);
      alert("Não foi possível atualizar o funil do lead.");
    } finally { setSavingLeadMeta(false); }
  }

  async function saveLeadCode() {
    if (!leadMeta?.id) return;
    const value = leadCodeDraft.trim();
    const { error } = await supabase.from("leads").update({ lead_name: value || null }).eq("id", leadMeta.id);
    if (error) {
      console.error("saveLeadCode error:", error);
      alert("Não foi possível salvar o nome do lead.");
      return;
    }
    setLeadMeta((prev) => prev ? { ...prev, lead_name: value || null } : prev );

    const jid = leadMeta.remote_jid || currentLead;
    if (jid) {
      setLeadCache((prev: any) => {
        const cur = prev?.[jid] || {};
        return { ...prev, [jid]: { ...cur, lead_name: value || null } };
      });
    }

    setEditingLeadCode(false);
  }

  async function updateLeadStage(stageId: string | null) {
    if (!leadMeta?.id) return;
    setSavingLeadMeta(true);
    try {
      const { error } = await supabase.from("leads").update({ current_stage_id: stageId }).eq("id", leadMeta.id);
      if (error) throw error;
      setLeadMeta((prev) => (prev ? { ...prev, current_stage_id: stageId } : prev));
      
      const jid = leadMeta.remote_jid || currentLead;
      if (jid) {
        setLeadCache((prev: any) => {
          const cur = prev?.[jid] || {};
          return { ...prev, [jid]: { ...cur, current_stage_id: stageId } };
        });
      }
    } catch (e) {
      console.error("updateLeadStage error:", e);
      alert("Não foi possível atualizar a etapa do lead.");
    } finally { setSavingLeadMeta(false); }
  }

  async function handleCloseDeal() {
    if (!leadMeta?.id || !companyId) return;
    
    const confirm = window.confirm("🏆 Disparar comemoração de contrato fechado na TV?");
    if (!confirm) return;

    setIsClosingDeal(true);
    try {
      const clientName = leadMeta.lead_name || leadMeta.lead_code || leadMeta.number_lead || currentLead || "Cliente";

      await fetch("https://conversia-n8n.njuzo4.easypanel.host/webhook/contratofechadocrm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          lead_id: leadMeta.id,
          lead_name: clientName,
          remote_jid: currentLead || "",
          seller_name: mySenderName,
          seller_id: myUserId,
          timestamp: new Date().toISOString()
        }),
      });

      alert("🎉 BOOOM! Comemoração enviada para a TV com sucesso!");
    } catch (err) {
      console.error("Erro ao comemorar contrato:", err);
      alert("Oops! Não foi possível conectar com a TV no momento.");
    } finally {
      setIsClosingDeal(false);
    }
  }

  async function deleteConversation(remoteJid: string) {
    const jid = normalizeJid(remoteJid);
    if (!isAdmin) {
      hideConversationForUser(jid);
      setContextMenu({ open: false, x: 0, y: 0, jid: null });
      return;
    }
    
    if (!jid) return;
    const ok = confirm("Apagar esta conversa?\n\nTodo o histórico de mensagens será removido, mas o lead será mantido no CRM.");
    if (!ok) return;

    try {
      const { error: convErr } = await supabase.from("wpp_conversations").delete().eq("remote_jid", jid).eq("company_id", companyId).not("company_id", "is", null);
      if (convErr) throw convErr;
      await supabase.from("leads").update({ last_message_at: null }).eq("remote_jid", jid).eq("company_id", companyId);
      setLeadCache((prev) => {
        const next = { ...prev };
        if (next[jid]) next[jid] = { ...next[jid], last_message_at: null };
        return next;
      });

      if (currentLeadRef.current === jid) {
        setCurrentLead(null);
        setLeadMeta(null);
        setStages([]);
        clearChatParamsInUrl();
        setJidFromUrlState(null);
      }

      setContextMenu({ open: false, x: 0, y: 0, jid: null });
      setMessages((prev) => prev.filter((m) => m.remote_jid !== jid));
      loadUnreadByConversation();
    } catch (e) {
      console.error("deleteConversation error:", e);
      alert("Não foi possível apagar a conversa.");
    }
  }

  function openContextMenu(e: any, jid: string) {
    e.preventDefault();

    const menuHeight = 200;
    const menuWidth = 220;

    let x = e.clientX ?? e.pageX ?? 0;
    let y = e.clientY ?? e.pageY ?? 0;

    if (y + menuHeight > window.innerHeight) {
      y = y - menuHeight;
    }

    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth;
    }

    setContextMenu({ open: true, x, y, jid });
  }

  // Long press + swipe para mobile
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const swipeRef = useRef<{ startX: number; startY: number; jid: string; swiped: false | "left" | "right" } | null>(null);
  const SWIPE_THRESHOLD = 80; // px mínimo para considerar swipe

  function handleTouchStart(e: React.TouchEvent, jid: string) {
    longPressTriggeredRef.current = false;
    const touch = e.touches[0];
    const tx = touch.clientX;
    const ty = touch.clientY;
    swipeRef.current = { startX: tx, startY: ty, jid, swiped: false };
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      if (navigator.vibrate) navigator.vibrate(30);
      openContextMenu({ preventDefault: () => {}, clientX: tx, clientY: ty }, jid);
    }, 500);
  }

  function handleTouchEnd() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    // Swipe para direita → marcar como lida
    if (swipeRef.current?.swiped === "right") {
      longPressTriggeredRef.current = true; // bloqueia onClick
      markConversationAsRead(swipeRef.current.jid);
      if (navigator.vibrate) navigator.vibrate(20);
    }
    // Swipe para esquerda → abrir context menu
    if (swipeRef.current?.swiped === "left") {
      longPressTriggeredRef.current = true; // bloqueia onClick
      const jid = swipeRef.current.jid;
      const tx = swipeRef.current.startX;
      const ty = swipeRef.current.startY;
      if (navigator.vibrate) navigator.vibrate(30);
      openContextMenu({ preventDefault: () => {}, clientX: tx, clientY: ty }, jid);
    }
    swipeRef.current = null;
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!swipeRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - swipeRef.current.startX;
    const dy = Math.abs(touch.clientY - swipeRef.current.startY);

    // Se moveu mais vertical que horizontal, é scroll — cancela tudo
    if (dy > 30) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      swipeRef.current = null;
      return;
    }

    // Se moveu horizontal, cancelar o long press
    if (Math.abs(dx) > 10 && longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    // Detecta direção do swipe
    if (dx > SWIPE_THRESHOLD) {
      swipeRef.current.swiped = "right";
    } else if (dx < -SWIPE_THRESHOLD) {
      swipeRef.current.swiped = "left";
    } else {
      swipeRef.current.swiped = false;
    }
  }

  useEffect(() => {
    if (!contextMenu.open) return;
    const close = () => setContextMenu((p) => ({ ...p, open: false }));
    window.addEventListener("click", close);
    window.addEventListener("scroll", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close); };
  }, [contextMenu.open]);

  useEffect(() => {
    if (!currentLead) return;
    if (currentMessages.length === 0) return;
    if (isSwitchingChat) return;
    const raf = requestAnimationFrame(() => { messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end", }); });
    return () => cancelAnimationFrame(raf);
  }, [currentLead, currentMessages.length, isSwitchingChat]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (!currentLead) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const newMedia: PendingMedia[] = [];

    files.forEach((file) => {
      let type: MediaType | null = null;
      const ext = file.name.split(".").pop()?.toLowerCase();
      const mime = file.type;

      if (mime.startsWith("image/") || (ext && MEDIA_CONFIG.image.extensions.includes(ext))) type = "image";
      else if (mime.startsWith("video/") || (ext && MEDIA_CONFIG.video.extensions.includes(ext))) type = "video";
      else if (mime.startsWith("audio/") || (ext && MEDIA_CONFIG.audio.extensions.includes(ext))) type = "audio";
      else if (mime === "application/pdf" || (ext && MEDIA_CONFIG.document.extensions.includes(ext))) type = "document";

      if (type === "video" && ext !== "mp4") {
        alert("Atenção: Apenas vídeos em MP4 são aceitos pelo sistema no momento.");
        return; 
      }

      if (type) {
        newMedia.push({ file, url: URL.createObjectURL(file), type });
      }
    });

    if (newMedia.length > 0) {
      setPendingMedia((prev) => [...prev, ...newMedia]);
    } else {
      alert("Formato de arquivo não suportado.");
    }
  };

  async function sendMessage() {
    if (!text.trim() && !forwardingMessage && pendingMedia.length === 0) return;
    if (!currentLead) return;

    let instanceId: any = null;
    try { instanceId = getInstanceForSend(); } catch { instanceId = null; }
    const fallbackInstanceIdForSend = instancias.find((i) => i.is_default)?.instance_key ?? null;

    const messageText = text.trim();
    const replySnapshot = replyingTo;
    if (replyingTo) setReplyingTo(null);
    setText("");

    const localClientId = (globalThis.crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const localCreatedAt = new Date().toISOString();

    const optimisticMsg: Message = {
      id: `local:${localClientId}`,
      remote_jid: currentLead,
      instance_id: instanceId || fallbackInstanceIdForSend || "",
      company_id: companyId,
      from_me: true,
      message: messageText,
      message_type: "text",
      created_at: localCreatedAt,
      media_url: null,
      raw_payload: {
        local_client_id: localClientId,
        sent_by_name: mySenderName,
        sent_by_role: isAdmin ? "admin" : "user",
        sent_by_user_id: (user as any)?.id ?? null,
        quoted_message_id: replySnapshot?.message_id ?? null,
        my_context: buildMyContext(replySnapshot, leadMeta?.lead_name || leadMeta?.lead_code || leadMeta?.name || "Contato", mySenderName),
      },
      quoted_message_id: replySnapshot?.message_id ?? null,
      my_context: buildMyContext(replySnapshot, leadMeta?.lead_name || leadMeta?.lead_code || leadMeta?.name || "Contato", mySenderName),
      wa_sent_at: null,
      wa_delivered_at: null,
      wa_read_at: null,
      ack: 0,
      _local_status: "pending",
      _local_client_id: localClientId,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    await markConversationAsRead(currentLead);

    // ─── Roteamento por provider: YCloud usa proxy n8n; Evolution segue fluxo abaixo ───
    const lastMsgProvider: string | null = (() => {
      for (let i = currentMessages.length - 1; i >= 0; i--) {
        const m: any = currentMessages[i];
        if (m?.provider) return m.provider;
      }
      return null;
    })();

    if (lastMsgProvider === "ycloud" && pendingMedia.length === 0) {
      try {
        // Descobre qual número da empresa usar (último msg YCloud da conv ou primeiro ativo)
        let phoneNumberMetaId: string | null = null;
        let fromPhone: string | null = null;

        const lastYcloud: any = [...currentMessages]
          .reverse()
          .find((m: any) => m?.provider === "ycloud" && m?.ycloud_phone_number_id);

        if (lastYcloud?.ycloud_phone_number_id) {
          const { data: phoneData } = await supabase
            .from("ycloud_phone_numbers" as any)
            .select("phone_number_id, display_phone")
            .eq("id", lastYcloud.ycloud_phone_number_id)
            .maybeSingle();
          if (phoneData) {
            phoneNumberMetaId = (phoneData as any).phone_number_id || null;
            const dp = String((phoneData as any).display_phone || "");
            fromPhone = dp.replace(/\D/g, "") || null;
          }
        }

        if (!phoneNumberMetaId && companyId) {
          const { data: phoneData } = await supabase
            .from("ycloud_phone_numbers" as any)
            .select("phone_number_id, display_phone")
            .eq("company_id", companyId)
            .eq("active", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (phoneData) {
            phoneNumberMetaId = (phoneData as any).phone_number_id || null;
            const dp = String((phoneData as any).display_phone || "");
            fromPhone = dp.replace(/\D/g, "") || null;
          }
        }

        if (!phoneNumberMetaId) {
          throw new Error("Nenhum número YCloud ativo encontrado pra esta empresa.");
        }

        const r = await sendYCloudMessage({
          from: fromPhone || undefined,
          phone_number_id: phoneNumberMetaId,
          to: String(currentLead).replace(/\D/g, ""),
          type: "text",
          text: messageText,
          client_id: localClientId,
        });

        if (!r.ok) {
          throw new Error(r.message || r.error || "Falha YCloud");
        }

        // Sucesso: o proxy já inseriu em wpp_conversations; o realtime vai dedup pelo client_id.
        // Atualiza otimística local com message_id (UI mostra ✓ assim que chegar).
        if (r.wamid) {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== optimisticMsg.id) return m;
              return { ...(m as any), message_id: r.wamid, _local_status: "pending" } as any;
            })
          );
        }
        setReplyingTo(null);
        return; // não cai no flow Evolution
      } catch (err: any) {
        console.error("Erro ao enviar via YCloud:", err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticMsg.id ? ({ ...(m as any), _local_status: "failed" } as any) : m
          )
        );
        alert(`Falha ao enviar via YCloud: ${err?.message || err}`);
        return;
      }
    }

    try {
      let payload: any = {
        number: currentLead,
        text: messageText,
        local_client_id: localClientId,
        sent_at: localCreatedAt,
        company_id: companyId,
        sent_by_name: mySenderName,
        sent_by_role: isAdmin ? "admin" : "user",
        sent_by_user_id: (user as any)?.id ?? null,
        quoted_message_id: replySnapshot?.message_id ?? null,
        my_context: buildMyContext(replySnapshot, leadMeta?.lead_name || leadMeta?.lead_code || leadMeta?.name || "Contato", mySenderName),
        raw_payload: {
          local_client_id: localClientId,
          sent_at: localCreatedAt,
          sent_by_name: mySenderName,
          sent_by_role: isAdmin ? "admin" : "user",
          sent_by_user_id: (user as any)?.id ?? null,
          quoted_message_id: replySnapshot?.message_id ?? null,
          my_context: buildMyContext(replySnapshot, leadMeta?.lead_name || leadMeta?.lead_code || leadMeta?.name || "Contato", mySenderName),
        },
      };

      if (replySnapshot?.message_id) { payload.quoted = { key: { id: replySnapshot.message_id } }; }

      let usedInstanceId = instanceId || fallbackInstanceIdForSend || "";
      let data: any = null;

      try {
        const r1 = await __sendTextWebhook(instancias as any, instanceId || "", payload);
        data = r1.data;
        usedInstanceId = r1.usedInstanceId;
      } catch (err1) {
        const canFallback = !!fallbackInstanceIdForSend && fallbackInstanceIdForSend !== instanceId && instancias.some((i) => i.instance_key === fallbackInstanceIdForSend && i.status === "CONNECTED");
        if (!canFallback) throw err1;

        const r2 = await __sendTextWebhook(instancias as any, (fallbackInstanceIdForSend as string) || "", payload);
        data = r2.data;
        usedInstanceId = r2.usedInstanceId;

        try { await handleChangeInstance(usedInstanceId); } catch (e) { console.warn("Não foi possível persistir instância fallback no lead:", e); }
      }

      const extractedMessageId = data?.key?.id || data?.messageId || data?.id || data?.message_id || null;
      const persistedMyContext = buildMyContext(replySnapshot, leadMeta?.lead_name || leadMeta?.lead_code || leadMeta?.name || "Contato", mySenderName);
      const persistedRawPayload = {
        ...(typeof data === "object" && data ? data : {}),
        local_client_id: localClientId,
        sent_at: localCreatedAt,
        sent_by_name: mySenderName,
        sent_by_role: isAdmin ? "admin" : "user",
        sent_by_user_id: (user as any)?.id ?? null,
        quoted_message_id: replySnapshot?.message_id ?? null,
        my_context: persistedMyContext,
        quoted: replySnapshot?.message_id ? { key: { id: replySnapshot.message_id } } : null,
      };

      try {
        let attempts = 0;
        const tryUpdateContext = async () => {
          const { data: recentMsgs } = await supabase
            .from("wpp_conversations")
            .select("id")
            .eq("company_id", companyId)
            .eq("from_me", true)
            .eq("remote_jid", currentLead)
            .eq("message", messageText)
            .order("created_at", { ascending: false })
            .limit(1);

          if (recentMsgs && recentMsgs.length > 0) {
            await supabase
              .from("wpp_conversations")
              .update({
                raw_payload: persistedRawPayload as any,
                quoted_message_id: replySnapshot?.message_id ?? null,
              } as any)
              .eq("id", recentMsgs[0].id);
          } else {
            if (attempts < 6) {
              attempts++;
              setTimeout(tryUpdateContext, 1500); 
            }
          }
        };
        
        if (replySnapshot?.message_id) {
            tryUpdateContext();
        }
      } catch (patchErr) {
        console.warn("Falha ao reaplicar contexto da resposta:", patchErr);
      }
      setReplyingTo(null);

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== optimisticMsg.id) return m;
          return {
            ...(m as any),
            instance_id: usedInstanceId || (m as any).instance_id,
            message_id: extractedMessageId || (m as any).message_id || null,
            raw_payload: {
              ...(((m as any).raw_payload && typeof (m as any).raw_payload === "object") ? (m as any).raw_payload : {}),
              ...persistedRawPayload,
              message_id: extractedMessageId,
            },
            quoted_message_id: (m as any).quoted_message_id ?? replySnapshot?.message_id ?? null,
            my_context: (m as any).my_context ?? persistedMyContext,
            _local_status: "pending",
            _local_client_id: localClientId,
          } as any;
        })
      );

    } catch (err) {
      console.error("Erro ao enviar mensagem:", err);
      setMessages((prev) => prev.map((m) => m.id === optimisticMsg.id ? { ...(m as any), _local_status: "failed" } : m ));
      alert("Falha ao enviar mensagem. Verifique sua conexão/instância.");
    }
  }

async function sendReaction(msg: Message, emoji: string) {
  if (!currentLead) return;

  const messageId =
    msg.message_id ||
    (msg as any).raw_payload?.key?.id ||
    (msg as any).raw_payload?.messageId ||
    msg.id;

  if (!messageId || String(messageId).startsWith('local:')) {
    console.warn("Não é possível reagir a uma mensagem sem ID oficial do WhatsApp.");
    return;
  }

  const instanceId = getInstanceForSend();
  const localReactionId = `local:react:${Date.now()}`;

  // Otimístico: mostra a reação na hora
  const optimisticReaction = {
    id: localReactionId,
    remote_jid: currentLead,
    instance_id: instanceId || "",
    company_id: companyId,
    from_me: true,
    message: emoji,
    message_type: "reaction",
    created_at: new Date().toISOString(),
    context_quoted_message_id: messageId,
    raw_payload: { reaction: emoji, quoted_message_id: messageId },
  };
  setMessages((prev) => [...prev, optimisticReaction as any]);

  try {
    // Envia a reação via webhook (WhatsApp)
    await __sendReactionWebhook(instancias, instanceId || "", {
      reaction: emoji,
      messageId: messageId,
      fromMe: msg.from_me,
      quoted_message_id: messageId,
      number: currentLead,
      company_id: companyId,
      sent_by_user_id: user?.id,
      sent_by_name: mySenderName
    });

    // Persiste a reação no banco para não sumir ao recarregar
    const { data: inserted } = await supabase.from("wpp_conversations").insert({
      remote_jid: currentLead,
      company_id: companyId,
      from_me: true,
      message: emoji,
      message_type: "reaction",
      context_quoted_message_id: messageId,
      created_at: new Date().toISOString(),
      sent_by_user_id: user?.id,
    }).select("id").single();

    // Substituir o ID local pelo ID real do banco (evita duplicação pelo realtime)
    if (inserted?.id) {
      setMessages((prev) => prev.map(m => m.id === localReactionId ? { ...m, id: inserted.id } : m));
    }

    await markConversationAsRead(currentLead);

  } catch (err) {
    console.error("Erro ao enviar reação:", err);
    setMessages((prev) => prev.filter(m => m.id !== localReactionId));
  }
}

  async function _sendSingleMediaItem(file: File, previewUrl: string, mediaType: MediaType, captionText: string) {
    if (!currentLead) return;

    let instanceId: any = null;
    try { instanceId = getInstanceForSend(); } catch { instanceId = null; }
    const fallbackInstanceIdForSend = instancias.find((i) => i.is_default)?.instance_key ?? null;

    mediaSeqRef.current += 1;
    
    const replySnapshot = replyingTo;

    const localClientId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const localCreatedAt = new Date().toISOString();
    const caption = captionText || "";
    const localPreviewUrl = previewUrl || URL.createObjectURL(file);

    const myContextData = buildMyContext(replySnapshot, leadMeta?.lead_name || leadMeta?.lead_code || leadMeta?.name || "Contato", mySenderName);

    const optimisticMsg: Message = {
      id: `local:media:${localClientId}`,
      remote_jid: currentLead,
      instance_id: instanceId || fallbackInstanceIdForSend || "",
      company_id: companyId,
      from_me: true,
      message: caption || null,
      message_type: mediaType,
      created_at: localCreatedAt,
      media_url: null,
      _local_preview_url: localPreviewUrl,
      raw_payload: {
        local_client_id: localClientId,
        client_media_id: localClientId,
        client_media_seq: mediaSeqRef.current,
        client_sent_at: localCreatedAt,
        file_name: file.name,
        file_type: file.type || "",
        file_size: file.size,
        sent_by_name: mySenderName,
        sent_by_role: isAdmin ? "admin" : "user",
        sent_by_user_id: (user as any)?.id ?? null,
        quoted_message_id: replySnapshot?.message_id ?? null,
        my_context: myContextData,
      },
      quoted_message_id: replySnapshot?.message_id ?? null,
      my_context: myContextData,
      wa_sent_at: null,
      wa_delivered_at: null,
      wa_read_at: null,
      ack: 0,
      _local_status: "pending",
      _local_client_id: localClientId,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    await markConversationAsRead(currentLead);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    // Conversão de áudio (fluxo Evolution): converte só m4a/mp4/aac (iPhone) pra OGG.
    // O fluxo YCloud tem conversão própria mais agressiva dentro do seu branch (abaixo).
    let fileToSend = file;
    if (mediaType === "audio") {
      const audioExt = file.name.split('.').pop()?.toLowerCase();
      if (audioExt === "m4a" || file.type.includes("mp4") || file.type.includes("aac")) {
        try {
          const converterUrl = (import.meta.env.VITE_DOCX_CONVERTER_URL || "https://converter.zapcompany.com.br/converter-docx-pdf").replace("/converter-docx-pdf", "/converter-audio-ogg");
          const convertFd = new FormData();
          convertFd.append("file", file, file.name);
          const convertRes = await fetch(converterUrl, { method: "POST", body: convertFd });
          if (convertRes.ok) {
            const oggBlob = await convertRes.blob();
            const oggName = file.name.replace(/\.[^.]+$/, ".ogg");
            fileToSend = new File([oggBlob], oggName, { type: "audio/ogg" });
            console.log("[Audio] Convertido para OGG antes do envio:", oggName);
          }
        } catch (e) {
          console.warn("[Audio] Falha na conversão para OGG, enviando original:", e);
        }
      }
    }

    // ─── Roteamento por provider: YCloud usa Storage + proxy n8n ───
    const lastMsgProviderForMedia: string | null = (() => {
      for (let i = currentMessages.length - 1; i >= 0; i--) {
        const m: any = currentMessages[i];
        if (m?.provider) return m.provider;
      }
      return null;
    })();

    if (lastMsgProviderForMedia === "ycloud" && companyId) {
      try {
        // YCloud (Meta) só aceita: audio/ogg, audio/mpeg, audio/amr, audio/mp4, audio/aac.
        // Garantir OGG aqui (sem afetar fluxo Evolution).
        let ycloudFile = fileToSend;
        if (mediaType === "audio") {
          const audioExtY = (ycloudFile.name.split(".").pop() || "").toLowerCase();
          const mimeStrY = (ycloudFile.type || "").toLowerCase();
          // Container OGG é aceito (qualquer codec). Webm com codec opus NÃO é aceito pela Meta.
          const isAlreadyOgg = audioExtY === "ogg" || mimeStrY.startsWith("audio/ogg");
          if (!isAlreadyOgg) {
            try {
              const converterUrl = (import.meta.env.VITE_DOCX_CONVERTER_URL || "https://converter.zapcompany.com.br/converter-docx-pdf").replace("/converter-docx-pdf", "/converter-audio-ogg");
              const convertFd = new FormData();
              convertFd.append("file", ycloudFile, ycloudFile.name);
              const convertRes = await fetch(converterUrl, { method: "POST", body: convertFd });
              if (convertRes.ok) {
                const oggBlob = await convertRes.blob();
                const oggName = ycloudFile.name.replace(/\.[^.]+$/, ".ogg");
                ycloudFile = new File([oggBlob], oggName, { type: "audio/ogg" });
                console.log("[YCloud] Audio convertido pra OGG:", oggName, "(original:", mimeStrY || audioExtY, ")");
              } else {
                console.warn("[YCloud] Conversor retornou HTTP", convertRes.status, "— Meta provavelmente vai rejeitar");
              }
            } catch (e) {
              console.warn("[YCloud] Falha ao converter audio pra OGG:", e);
            }
          }
        }

        // Upload da mídia pro Supabase Storage (bucket público whatsapp-media)
        const publicUrl = await uploadMediaToStorage(ycloudFile, String(companyId), mediaType);

        // Descobre número da empresa (último msg YCloud da conv ou primeiro ativo)
        let phoneNumberMetaId: string | null = null;
        let fromPhone: string | null = null;

        const lastYcloud: any = [...currentMessages]
          .reverse()
          .find((m: any) => m?.provider === "ycloud" && m?.ycloud_phone_number_id);

        if (lastYcloud?.ycloud_phone_number_id) {
          const { data: phoneData } = await supabase
            .from("ycloud_phone_numbers" as any)
            .select("phone_number_id, display_phone")
            .eq("id", lastYcloud.ycloud_phone_number_id)
            .maybeSingle();
          if (phoneData) {
            phoneNumberMetaId = (phoneData as any).phone_number_id || null;
            fromPhone = String((phoneData as any).display_phone || "").replace(/\D/g, "") || null;
          }
        }
        if (!phoneNumberMetaId) {
          const { data: phoneData } = await supabase
            .from("ycloud_phone_numbers" as any)
            .select("phone_number_id, display_phone")
            .eq("company_id", companyId)
            .eq("active", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (phoneData) {
            phoneNumberMetaId = (phoneData as any).phone_number_id || null;
            fromPhone = String((phoneData as any).display_phone || "").replace(/\D/g, "") || null;
          }
        }
        if (!phoneNumberMetaId) {
          throw new Error("Nenhum número YCloud ativo encontrado pra esta empresa.");
        }

        // Envia via proxy
        const r = await sendYCloudMessage({
          from: fromPhone || undefined,
          phone_number_id: phoneNumberMetaId,
          to: String(currentLead).replace(/\D/g, ""),
          type: mediaType as any,
          media_url: publicUrl,
          caption: caption || undefined,
          filename: mediaType === "document" ? file.name : undefined,
          client_id: localClientId,
        });
        if (!r.ok) throw new Error(r.message || r.error || "Falha YCloud");

        // Atualiza otimística com URL pública + wamid (proxy já INSERT, realtime dedup)
        setMessages((prev) =>
          prev.map((m) => {
            if ((m as any)?._local_client_id !== localClientId) return m;
            return {
              ...(m as any),
              media_url: publicUrl,
              message_id: r.wamid || (m as any).message_id || null,
              wa_sent_at: r.sent_at || new Date().toISOString(),
              ack: 1,
              _local_status: "pending",
            } as any;
          })
        );
        clearTimeout(timeout);
        return;
      } catch (err: any) {
        console.error("Erro ao enviar mídia via YCloud:", err);
        setMessages((prev) =>
          prev.map((m) => {
            if ((m as any)?._local_client_id !== localClientId) return m;
            return { ...(m as any), _local_status: "failed" } as any;
          })
        );
        alert(`Falha ao enviar mídia via YCloud: ${err?.message || err}`);
        clearTimeout(timeout);
        return;
      }
    }

    try {
      const buildFormData = (currentInstIdOrKey: string) => {
        const inst = instancias.find((i: any) =>
          i.instance_key === currentInstIdOrKey ||
          i.id === currentInstIdOrKey ||
          String(i.phone_number) === String(currentInstIdOrKey)
        );

        const finalInstanceKey = inst?.instance_key || currentInstIdOrKey;
        const finalPhoneNumber = inst?.phone_number ? String(inst.phone_number) : "";
        const finalInstanceId  = inst?.id || "";

        const fd = new FormData();
        const isVideo = mediaType === "video";
        const finalFileName = isVideo ? "video.mp4" : fileToSend.name;
        const finalMimeType = isVideo ? "video/mp4" : (fileToSend.type || "");
        
        // --- NOVA LÓGICA AQUI ---
        // Se for document e tiver extensão doc/docx, mandamos "word" para o webhook
        let finalTypeToSend = mediaType;
        const ext = finalFileName.split('.').pop()?.toLowerCase();
        if (mediaType === "document" && (ext === "doc" || ext === "docx")) {
          finalTypeToSend = "word";
        }
        // ------------------------
        
        fd.append("file", fileToSend, finalFileName);
        fd.append("type", finalTypeToSend); // Usando a variável nova
        fd.append("media_type", finalTypeToSend); // Usando a variável nova
        fd.append("number", currentLead);
        fd.append("text", caption);
        fd.append("caption", caption);
        fd.append("mimetype", finalMimeType);
        fd.append("instance_key", finalInstanceKey);
        fd.append("instance_phone_number", finalPhoneNumber);
        fd.append("instance_id", finalInstanceId); 
        fd.append("company_id", String(companyId ?? ""));
        fd.append("sent_by_name", mySenderName);
        fd.append("sent_by_role", isAdmin ? "admin" : "user");
        fd.append("sent_by_user_id", String((user as any)?.id ?? ""));
        fd.append("local_client_id", localClientId);
        fd.append("sent_at", localCreatedAt);
        
        if (replySnapshot?.message_id) {
          fd.append("quoted_message_id", replySnapshot.message_id);
          fd.append("quoted", JSON.stringify({ key: { id: replySnapshot.message_id } }));
        }

        if (myContextData) {
          fd.append("my_context", JSON.stringify(myContextData));
        }

        fd.append("file_name", file.name);
        fd.append("file_type", file.type || "");
        fd.append("file_size", String(file.size));
        
        return fd;
      };

      const postMedia = async (instanceKey: string, leadInstanceKey: string | null, fallbackInstanceKey: string | null) => {
        const webhookUrl: string | undefined = (import.meta.env.VITE_INBOX_MEDIA_WEBHOOK_URL as string | undefined) || (import.meta.env.VITE_INBOX_TEXT_WEBHOOK_URL as string | undefined);
        if (!webhookUrl) throw new Error("INBOX webhook URL não configurada.");
        const fd = buildFormData(instanceKey);
        const targetUrl = webhookUrl || "https://infnitycrm.zapcompany.com.br/webhook/enviosmidiacrm";
        const res = await fetch(targetUrl, { method: "POST", body: fd, signal: controller.signal, });
        const bodyText = await res.text().catch(() => "");
        return { res, bodyText };
      };

      let usedInstanceId = instanceId || fallbackInstanceIdForSend || "";
      let attempt = await postMedia(usedInstanceId || "", instanceId ?? null, fallbackInstanceIdForSend ?? null);

      if (!attempt.res.ok) {
        const canFallback = !!fallbackInstanceIdForSend && fallbackInstanceIdForSend !== usedInstanceId && instancias.some((i) => i.instance_key === fallbackInstanceIdForSend && i.status === "CONNECTED");

        if (canFallback) {
          usedInstanceId = fallbackInstanceIdForSend as string;
          attempt = await postMedia(usedInstanceId, null, null);

          if (attempt.res.ok) {
            try { await handleChangeInstance(usedInstanceId); } catch (e) { console.warn("Não foi possível persistir instância fallback no lead:", e); }

            setMessages((prev) =>
              prev.map((m) => {
                if ((m as any)?._local_client_id !== localClientId) return m;
                return { ...(m as any), instance_id: usedInstanceId } as any;
              })
            );
          }
        }
      }

      const res = attempt.res;
      const bodyText = attempt.bodyText;

      if (!res.ok) { throw new Error(bodyText || `HTTP ${res.status}`); }

      setMessages((prev) =>
        prev.map((m) => {
          if ((m as any)?._local_client_id !== localClientId) return m;
          return { ...(m as any), wa_sent_at: new Date().toISOString(), ack: 1, } as any;
        })
      );

    } catch (err) {
      console.error("Erro ao enviar mídia:", err);
      setMessages((prev) =>
        prev.map((m) => {
          if ((m as any)?._local_client_id !== localClientId) return m;
          return { ...(m as any), _local_status: "failed" } as any;
        })
      );
      alert("Erro ao enviar mídia. Verifique o console.");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function sendPendingMedia() {
    if (!currentLead || pendingMedia.length === 0) return;

    const mediaToSend = [...pendingMedia];
    const currentText = mediaCaptionText;

    setPendingMedia([]);
    setMediaCaptionText("");
    if (replyingTo) setReplyingTo(null);
    if (fileInputRef.current) fileInputRef.current.value = "";

    for (let i = 0; i < mediaToSend.length; i++) {
      const media = mediaToSend[i];
      const caption = i === 0 ? currentText : "";

      await _sendSingleMediaItem(media.file, media.url, media.type, caption);
      
      if (i < mediaToSend.length - 1) {
        await new Promise((res) => setTimeout(res, 500));
      }
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newMedia: PendingMedia[] = [];

    files.forEach((file) => {
      let type: MediaType | null = null;
      const ext = file.name.split(".").pop()?.toLowerCase();
      const mime = file.type;

      if (mime.startsWith("image/") || (ext && MEDIA_CONFIG.image.extensions.includes(ext))) type = "image";
      else if (mime.startsWith("video/") || (ext && MEDIA_CONFIG.video.extensions.includes(ext))) type = "video";
      else if (mime.startsWith("audio/") || (ext && MEDIA_CONFIG.audio.extensions.includes(ext))) type = "audio";
      else if (mime === "application/pdf" || (ext && MEDIA_CONFIG.document.extensions.includes(ext))) type = "document";

      if (type === "video" && ext !== "mp4") {
        alert("Atenção: Apenas vídeos em MP4 são aceitos no momento.");
        return; 
      }

      if (type) {
        newMedia.push({ file, url: URL.createObjectURL(file), type });
      }
    });

    if (newMedia.length > 0) {
      setPendingMedia((prev) => [...prev, ...newMedia]);
    }
    e.target.value = "";
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true }, channelCount: { ideal: 1 }, },
      });

      mediaStreamRef.current = stream;

      if (audioContextRef.current) {
        try { await audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }

      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext: AudioContext = new AudioContextCtor();
      audioContextRef.current = audioContext;

      if (audioContext.state === "suspended") {
        try { await audioContext.resume(); } catch {}
      }

      const source = audioContext.createMediaStreamSource(stream);

      // --- INÍCIO DO CÓDIGO DO ANALISADOR DE ONDAS ---
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser); // Conecta o microfone no analisador

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateLevels = () => {
        analyser.getByteFrequencyData(dataArray);
        
        const step = Math.floor(dataArray.length / 5);
        const newLevels = [];
        
        for (let i = 0; i < 5; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) {
            sum += dataArray[i * step + j];
          }
          const avg = sum / step;
          const height = (avg / 255) * 24;
          newLevels.push(height);
        }
        
        setAudioLevels(newLevels);
        animationFrameRef.current = requestAnimationFrame(updateLevels);
      };
      
      updateLevels(); 
      // --- FIM DO CÓDIGO DO ANALISADOR DE ONDAS ---

      const highPass = audioContext.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.value = 90;
      highPass.Q.value = 0.707;

      const lowPass = audioContext.createBiquadFilter();
      lowPass.type = "lowpass";
      lowPass.frequency.value = 13000;
      lowPass.Q.value = 0.707;

      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 24;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      const destination = audioContext.createMediaStreamDestination();
      processedStreamRef.current = destination.stream;

      source.connect(highPass);
      highPass.connect(lowPass);
      lowPass.connect(compressor);
      compressor.connect(destination);

      const preferredTypes = [ "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4", "audio/aac" ];
      const chosenMimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t));

      const recorder = chosenMimeType ? new MediaRecorder(destination.stream, { mimeType: chosenMimeType }) : new MediaRecorder(destination.stream);

      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        try {
          const finalMimeType = recorder.mimeType || chosenMimeType || "audio/webm";
          const ext = finalMimeType.includes("mp4") ? "m4a" : finalMimeType.includes("aac") ? "m4a" : finalMimeType.includes("ogg") ? "ogg" : "webm";
          const blob = new Blob(audioChunksRef.current, { type: finalMimeType });
          const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: finalMimeType, });

          setPendingMedia([{ file, url: URL.createObjectURL(blob), type: "audio" }]);
        } finally {
          mediaStreamRef.current?.getTracks().forEach((t) => t.stop()); mediaStreamRef.current = null;
          processedStreamRef.current?.getTracks().forEach((t) => t.stop()); processedStreamRef.current = null;
          if (audioContextRef.current) { try { audioContextRef.current.close(); } catch {} audioContextRef.current = null; }
          if (recordingIntervalRef.current) { clearInterval(recordingIntervalRef.current); recordingIntervalRef.current = null; }
        }
      };

      recorder.start(1000); // chunks a cada 1s para não perder dados no Safari/iPhone
      setMediaRecorder(recorder);
      setIsRecording(true);

      setRecordingTime(0);
      if (recordingIntervalRef.current) { clearInterval(recordingIntervalRef.current); recordingIntervalRef.current = null; }
      recordingIntervalRef.current = window.setInterval(() => { setRecordingTime((prev) => prev + 1); }, 1000);
    } catch (err) {
      console.error("Erro ao iniciar gravação:", err);
      alert("Não foi possível acessar o microfone.");
    }
  }

  function stopRecording() {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setAudioLevels([4, 4, 4, 4, 4]);

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      // Forçar captura do último chunk antes de parar (fix Safari/iPhone)
      try { mediaRecorder.requestData(); } catch {}
      setTimeout(() => {
        if (mediaRecorder.state !== "inactive") {
          mediaRecorder.stop();
        }
        setIsRecording(false);
      }, 300);
    } else {
      setIsRecording(false);
    }
  }

  function cancelRecording() {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setAudioLevels([4, 4, 4, 4, 4]);

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.onstop = null; 
      mediaRecorder.stop();
    }
    
    setIsRecording(false);
    setPendingMedia([]);
    setRecordingTime(0);

    mediaStreamRef.current?.getTracks().forEach((t) => t.stop()); mediaStreamRef.current = null;
    processedStreamRef.current?.getTracks().forEach((t) => t.stop()); processedStreamRef.current = null;
    if (audioContextRef.current) { try { audioContextRef.current.close(); } catch {} audioContextRef.current = null; }
    if (recordingIntervalRef.current) { clearInterval(recordingIntervalRef.current); recordingIntervalRef.current = null; }
  }

  function renderAck(msg: Message) {
    if (!msg.from_me) return null;
    if (msg._local_status === "failed") { return <AlertCircle className="w-4 h-4 text-red-500" />; }
    if (msg._local_status === "pending" && !(msg.wa_sent_at || msg.ack === 1 || msg.ack === 2 || msg.ack === 3)) { return <Clock className="w-4 h-4 opacity-70" />; }
    if (msg.wa_read_at || msg.ack === 3) { return <CheckCheck className="w-4 h-4 text-blue-500" />; }
    if (msg.wa_delivered_at || msg.ack === 2) { return <CheckCheck className="w-4 h-4 opacity-70" />; }
    if (msg.wa_sent_at || msg.ack === 1) { return <Check className="w-4 h-4 opacity-70" />; }
    return <Check className="w-4 h-4 opacity-40" />;
  }

  function formatMessageWithLinks(text: string | null) {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return ( <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-800 break-all" onClick={(e) => e.stopPropagation()} > {part} </a> );
      }
      return part;
    });
  }

  function renderMessageBody(msg: Message) {
    const mediaSrc = msg.media_url || msg._local_preview_url || "";
    const url = mediaSrc.toLowerCase();
    const msgType = String(msg.message_type || "").toLowerCase();

    const renderCaption = () => {
      const raw = (msg.message || "").trim();
      if (!raw) return null;
      // Ignora placeholders que o WhatsApp/Evolution às vezes envia no lugar da legenda
      const placeholders = new Set(["img", "image", "video", "audio", "document", "word", "sticker"]);
      if (placeholders.has(raw.toLowerCase())) return null;
      return (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed w-full">
          {formatMessageWithLinks(msg.message)}
        </p>
      );
    }

    if (!msg.media_url && msg._local_preview_url) {
      if (msgType === "image") { 
        return ( 
          <div className="flex flex-col">
            <img src={mediaSrc} loading="lazy" decoding="async" className="rounded max-w-xs cursor-zoom-in" onClick={() => setZoomImageUrl(mediaSrc)} alt="Preview" />
            {renderCaption()}
          </div> 
        ); 
      }
      if (msgType === "video") { 
        return ( 
          <div className="flex flex-col">
            <video controls className="rounded max-w-xs"> <source src={mediaSrc} /> </video> 
            {renderCaption()}
          </div> 
        ); 
      }
      if (msgType === "audio") { 
        return ( <div className="flex flex-col gap-2"> <AudioMessage src={mediaSrc} variant={msg.from_me ? "sent" : "received"} /> </div> ); 
      }
      if (msgType === "document") { 
        return ( 
          <div className="flex flex-col">
            <a className="underline" href={mediaSrc} target="_blank" rel="noreferrer"> 📄 Abrir documento </a>
            {renderCaption()}
          </div> 
        ); 
      }
    }

    if (url.match(/\.(jpg|jpeg|png|webp)$/) || msgType === "image") {
      return ( 
        <div className="flex flex-col">
          <img src={mediaSrc} loading="lazy" decoding="async" className="rounded max-w-xs cursor-zoom-in" onClick={() => setZoomImageUrl(mediaSrc)} alt="Imagem" />
          {renderCaption()}
        </div> 
      );
    }
    
    if (url.match(/\.(mp4|webm|mov)$/) || msgType === "video") {
      return ( 
        <div className="flex flex-col">
          <video controls className="rounded max-w-xs"> <source src={mediaSrc} /> </video>
          {renderCaption()}
        </div> 
      );
    }
    
    // CORREÇÃO: Agora cobre Word, Excel, TXT, CSV e valida via msgType
    if (url.match(/\.(pdf|doc|docx|xls|xlsx|txt|csv)$/) || msgType === "document") {
      return (
        <div className="flex flex-col">
          <a className="underline text-primary hover:text-primary/80 font-medium" href={mediaSrc} target="_blank" rel="noreferrer" download>
            📄 Baixar documento
          </a>
          {renderCaption()}
        </div>
      );
    }

    if (url.match(/\.(mp3|ogg|opus|wav|m4a|webm)$/) || msgType === "audio") {
      return (
        <div className="flex flex-col gap-2">
          <AudioMessage src={mediaSrc} variant={msg.from_me ? "sent" : "received"} />
          {(!msg.transcription_status || msg.transcription_status === "idle") && ( <button className="self-start text-xs text-primary hover:underline" onClick={() => requestTranscription(msg.id)} > Transcrever áudio </button> )}
          {msg.transcription_status === "pending" && ( <span className="text-xs text-muted-foreground italic"> Transcrevendo áudio… </span> )}
          {msg.transcription_status === "done" && msg.transcription && ( <div className="text-sm text-muted-foreground bg-muted rounded-md p-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"> {msg.transcription} </div> )}
          {msg.transcription_status === "error" && ( <span className="text-xs text-red-500"> Erro ao transcrever áudio </span> )}
        </div>
      );
    }

    return ( <p className="whitespace-pre-wrap break-words text-sm leading-relaxed w-full"> {formatMessageWithLinks(msg.message)} </p> );
  }

  const handleCloseSummary = () => { setShowSummary(false); };

  const openAddUserDialogByJid = async (jid: string) => {
    let meta = leadCache[jid] || null;

    if (!meta) {
      const { data } = await supabase.from("leads").select("*").eq("remote_jid", jid).single();
      meta = data;
    }

    if (meta) {
      setAddUserSelectedId("unassigned");
      setAddUserLead(meta);

      try {
        const { data } = await supabase.from("lead_users").select("user_id").eq("lead_id", meta.id);
        const ids = Array.from(new Set([...(meta.assigned_user_id ? [String(meta.assigned_user_id)] : []), ...((data || []).map((r: any) => String(r.user_id))),]));
        setAddUserCurrentIds(ids);
      } catch {
        const ids = meta.assigned_user_id ? [String(meta.assigned_user_id)] : [];
        setAddUserCurrentIds(ids);
      }
    }
  };

  async function changeLeadOwner(userId: string | null) {
    if (!leadMeta?.id) return;
    if (!isAdmin) return;

    try {
      const { error } = await supabase.from("leads").update({ assigned_user_id: userId }).eq("id", leadMeta.id);
      if (error) throw error;

      if (userId === null) {
        try {
          const { error: delErr } = await supabase.from("lead_users").delete().eq("lead_id", leadMeta.id);
          if (delErr) { console.warn("Aviso: não foi possível limpar lead_users ao remover responsável:", delErr); }
        } catch (e) { console.warn("Aviso: erro ao tentar limpar lead_users:", e); }
      }

      if (companyId && userId) {
        const { error: notifError } = await supabase.from("notifications").insert({
          company_id: companyId,
          user_id: userId,
          type: "lead_assigned",
          title: "Novo lead atribuído",
          body: "Um lead foi atribuído a você.",
          meta: { lead_id: leadMeta.id, remote_jid: (leadMeta as any)?.remote_jid || currentLead || "", },
        });

        if (notifError) { console.error("Erro ao criar notificação (lead_assigned):", notifError); }
      }

      setLeadMeta((prev: any) => prev ? { ...prev, assigned_user_id: userId } : prev );

      const jid = (leadMeta as any)?.remote_jid || currentLead;
      const applyOptimisticToCache = () => {
        if (!jid) return;
        setLeadCache((prev: any) => {
          const cur = prev?.[jid] || {};
          const nextAssignedIds = userId ? [String(userId)] : [];
          return { ...prev, [jid]: { ...cur, assigned_user_id: userId, assigned_user_ids: nextAssignedIds, }, };
        });
      };

      // 1) Atualizacao otimista imediata (badge muda na hora)
      applyOptimisticToCache();

      await loadLeadsCache();

      // 2) Reaplica apos refetch — caso loadLeadsCache tenha lido dados stale por race
      //    com o UPDATE acima, ou tenha sobrescrito a cache no setLeadCache(map).
      applyOptimisticToCache();

      await loadMessages();
    } catch (err) {
      console.error("Erro ao trocar responsável:", err);
      alert("Não foi possível alterar o responsável do lead.");
    }
  }

  async function addUserToLead(userId: string) {
    if (!isAdmin) return;
    const leadId = addUserLead?.id ?? leadMeta?.id;
    const leadJid = (addUserLead?.remote_jid ?? leadMeta?.remote_jid) as string | undefined;
    if (!leadId || !userId) return;

    try {
      const { error } = await supabase.from("lead_users").upsert({ lead_id: leadId, user_id: userId }, { onConflict: "lead_id,user_id" }).select();
      if (error) throw error;

      if (addUserLead && !addUserLead.assigned_user_id) {
        const upd = await supabase.from("leads").update({ assigned_user_id: userId }).eq("id", leadId);
        if (upd.error) throw upd.error;
        setAddUserLead((prev: any) => (prev ? { ...prev, assigned_user_id: userId } : prev));
      }

      setAddUserCurrentIds((prev) => Array.from(new Set([...(prev || []), String(userId)])));

      if (leadJid) {
        setLeadCache((prev: any) => {
          const cur = prev?.[leadJid] || {};
          const curIds: string[] = Array.isArray(cur.assigned_user_ids) ? cur.assigned_user_ids : cur.assigned_user_id ? [String(cur.assigned_user_id)] : [];
          const nextIds = Array.from(new Set([...curIds, String(userId)]));
          return { ...prev, [leadJid]: { ...cur, assigned_user_ids: nextIds, }, };
        });
      }
    } catch (e) {
      console.error("addUserToLead error:", e);
      alert("Não foi possível acrescentar o usuário ao lead.");
    }
  }

  async function removeUserFromLead(userId: string) {
    if (!isAdmin) return;
    const leadId = addUserLead?.id ?? leadMeta?.id;
    const leadJid = (addUserLead?.remote_jid ?? leadMeta?.remote_jid) as string | undefined;
    if (!leadId || !userId) return;

    try {
      const { error } = await supabase.from("lead_users").delete().eq("lead_id", leadId).eq("user_id", userId);
      if (error) throw error;

      setAddUserCurrentIds((prev) => (prev || []).filter((id) => id !== String(userId)));

      let nextIds: string[] = [];

      if (leadJid) {
        const cur = (leadCache as any)?.[leadJid] || {};
        const curIds: string[] = Array.isArray(cur.assigned_user_ids) ? cur.assigned_user_ids : cur.assigned_user_id ? [String(cur.assigned_user_id)] : [];
        nextIds = curIds.filter((id) => id !== String(userId));

        setLeadCache((prev: any) => {
          const cur2 = prev?.[leadJid] || {};
          return { ...prev, [leadJid]: { ...cur2, assigned_user_ids: nextIds }, };
        });
      }

      const currentPrimary = String(addUserLead?.assigned_user_id ?? leadMeta?.assigned_user_id ?? (leadJid ? (leadCache as any)?.[leadJid]?.assigned_user_id : "") ?? "");

      if (currentPrimary && currentPrimary === String(userId)) {
        const newPrimary = nextIds.length ? nextIds[0] : null;

        const { error: upErr } = await supabase.from("leads").update({ assigned_user_id: newPrimary }).eq("id", leadId);

        if (upErr) {
          console.error("Erro ao atualizar assigned_user_id após remover usuário:", upErr);
        } else {
          if (leadMeta?.id === leadId) { setLeadMeta((prev: any) => (prev ? { ...prev, assigned_user_id: newPrimary } : prev)); }
          if (leadJid) {
            setLeadCache((prev: any) => {
              const cur3 = prev?.[leadJid] || {};
              return { ...prev, [leadJid]: { ...cur3, assigned_user_id: newPrimary, assigned_user_ids: nextIds, }, };
            });
          }
        }
      }

      return;
    } catch (e) {
      console.error("removeUserFromLead error:", e);
      alert("Não foi possível remover o usuário do lead.");
    }
  }

  const leadFonteInfo = useMemo(() => {
    const leadSource = (leadMeta as any)?.source as string | undefined;
    const conversationKey = currentLead ? getConversationInstanceId(currentLead) : null;

    const originalKey = (leadMeta as any)?.send_instance_key || (leadMeta as any)?.instance_key || conversationKey || "";
    const currentKey = getSelectedInstanceKey() || conversationKey || originalKey || "";

    const findInst = (key: string) => key ? (instancias || []).find((i: any) => i.instance_key === key) : null;

    const currentInst: any = findInst(currentKey);
    const originalInst: any = findInst(originalKey);

    const fmt = (inst: any, key: string) => {
      const label = (inst?.instance_name as string | undefined) || (inst?.instance_key as string | undefined) || key || "—";
      const phone = inst?.phone_number ? String(inst.phone_number) : null;
      const status = inst?.status as string | undefined;
      return { label, phone, status, key };
    };

    const cur = fmt(currentInst, currentKey);
    const orig = fmt(originalInst, originalKey);

    const curText = `${cur.label}${cur.phone ? ` • ${cur.phone}` : ""}`;
    const origText = `${orig.label}${orig.phone ? ` • ${orig.phone}` : ""}`;

    const showBoth = !!(orig.key && cur.key && orig.key !== cur.key && origText !== curText);
    const display = showBoth ? `${curText} · ${origText}` : curText;
    const tooltip = showBoth ? `Fonte atual: ${curText} | Fonte original: ${origText}` : `Fonte: ${curText}`;

    return { display, tooltip, leadSource, current: cur, original: orig, };
  }, [leadMeta, instancias, currentLead, messages, unreadByJid, selectedInstanceId]);


  async function openAddUserDialog(remote_jid: string) {
    if (!companyId || !isAdmin) return;

    try {
      const { data, error } = await supabase.from("leads").select("id, remote_jid, assigned_user_id").eq("company_id", companyId).eq("remote_jid", remote_jid).limit(1);
      if (error) throw error;

      let lead: any = data?.[0];

      if (!lead) {
        const lead_code = typeof crypto !== "undefined" && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `lead_${Date.now()}`;
        const ins = await supabase.from("leads").insert({ company_id: companyId, remote_jid, lead_code, assigned_user_id: null, }).select("id, remote_jid, assigned_user_id").single();
        if (ins.error) throw ins.error;
        lead = ins.data;
      }

      setAddUserSelectedId("unassigned");
      setAddUserLead(lead);

      try {
        const { data: links, error: linksError } = await supabase.from("lead_users").select("user_id").eq("lead_id", lead.id);
        if (linksError) throw linksError;
        const ids = Array.from(new Set([...(lead.assigned_user_id ? [String(lead.assigned_user_id)] : []), ...((links || []).map((r: any) => String(r.user_id))),]));
        setAddUserCurrentIds(ids);
      } catch {
        const ids = lead.assigned_user_id ? [String(lead.assigned_user_id)] : [];
        setAddUserCurrentIds(ids);
      }
    } catch (e) {
      console.error("openAddUserDialog error:", e);
      alert("Não foi possível abrir o vínculo de usuários.");
    }
  }

  // --- NOVO: CÁLCULO DE ESTATÍSTICAS DE NÃO LIDAS ---
  const unreadStats = useMemo(() => {
    let convCount = 0;
    let msgCount = 0;
    for (const msg of orderedLeads) {
      const count = unreadByJid.get(normalizeJid(msg.remote_jid))?.unread_count || 0;
      if (count > 0) {
        convCount++;
        msgCount += count;
      }
    }
    return { convCount, msgCount };
  }, [orderedLeads, unreadByJid]);
  // --------------------------------------------------

  return (
    <div className="flex h-[calc(100dvh-8rem-3.5rem)] md:h-[calc(100dvh-8rem)] gap-0 overflow-hidden">
      <style>{`@keyframes pulse-soft{0%{background-color:rgba(59,130,246,0.10)}50%{background-color:rgba(59,130,246,0.18)}100%{background-color:rgba(59,130,246,0.10)}}`}</style>

      {/* SIDEBAR */}
      {(!isMobile || !showChat) && (
        <div style={!isMobile ? { width: sidebarWidth } : undefined} className={`w-full lg:min-w-[280px] xl:min-w-[320px] lg:max-w-[700px] flex flex-col gap-4 h-full overflow-hidden border-r`} >
        <div className="relative mx-4 mt-4">
          <Search className="absolute left-3 top-2.5 h-4 w-4 opacity-60" />
          <Input placeholder="Buscar lead..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 pr-9" />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              title="Limpar busca"
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 px-4">
          <Button type="button" variant={onlyUnread ? "default" : "outline"} size="sm" className="h-9 shrink-0" onClick={() => setOnlyUnread((v) => !v)} >
            {onlyUnread ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
            Não lidas
          </Button>
          {onlyUnread && !unreadLoaded ? ( <span className="text-[11px] opacity-70">…</span> ) : null}
          {onlyUnread ? ( <Button type="button" variant="ghost" size="sm" className="h-9 w-9 px-0 shrink-0" onClick={() => setOnlyUnread(false)} aria-label="Limpar filtro" title="Limpar filtro" > <X className="h-4 w-4" /> </Button> ) : null}

          <select className="h-9 rounded-md border bg-background px-2 text-xs min-w-0 flex-1 truncate opacity-70 hover:opacity-100 transition" value={tagFilterId} onChange={(e) => setTagFilterId(e.target.value)} title="Filtrar por tag">
            <option value="">🏷 Todas</option>
            {tagsCatalog.map((t) => ( <option key={t.id} value={t.id}>{t.name}</option> ))}
          </select>
          {loadingTagFilter && tagFilterId ? <span className="text-[10px] opacity-50 shrink-0">…</span> : null}

          <div className="flex items-center gap-2 shrink-0">
            {isAdmin && (
              !leadSelectMode ? (
                <Button type="button" variant="outline" size="sm" className="h-9" title="Selecionar múltiplos leads" onClick={() => { setLeadSelectMode(true); setSelectedLeadJids(new Set()); }} > Selecionar </Button>
              ) : (
                <>
                  <Button type="button" variant="destructive" size="sm" className="h-9" disabled={selectedLeadJids.size === 0} title="Apagar histórico selecionado" onClick={bulkDeleteSelectedJids} > Apagar ({selectedLeadJids.size}) </Button>
                  <Button type="button" variant="outline" size="sm" className="h-9" title="Cancelar seleção" onClick={clearSelection} > Cancelar </Button>
                </>
              )
            )}
          </div>
        </div>

          {!isAdmin && hiddenJids.size > 0 && (
            <div className="flex items-center justify-between text-xs opacity-80 px-4">
              <span>{hiddenJids.size} conversa(s) oculta(s)</span>
              <button className="underline hover:opacity-100" onClick={() => setShowHiddenDialog(true)} > Ver </button>
            </div>
          )}

        {isManager && (
          <div className="flex gap-2 mt-2 px-4">
            <Select value={urlUserFilter || adminUserFilter} onValueChange={(v) => { setAdminUserFilter(v); }} >
              <SelectTrigger className="h-9">
                <User className="mr-2 h-4 w-4 opacity-70" />
                <SelectValue placeholder="Responsável" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="unassigned">Não atribuídos</SelectItem>
                {teamUsers.map((u) => ( <SelectItem key={u.id} value={u.id}> {u.nome} </SelectItem> ))}
              </SelectContent>
            </Select>

            <Select value={adminFunnelFilter} onValueChange={setAdminFunnelFilter}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Funil" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos funis</SelectItem>
                {funnels.map((f) => ( <SelectItem key={f.id} value={f.id}> {f.name} </SelectItem> ))}
              </SelectContent>
            </Select>

            {adminFunnelFilter !== "all" && filterStages.length > 0 && (
              <Select value={adminStageFilter} onValueChange={setAdminStageFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Etapa" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas etapas</SelectItem>
                  {filterStages.map((s) => ( <SelectItem key={s.id} value={s.id}> {s.name} </SelectItem> ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {/* ORDENAÇÃO + NÃO LIDAS */}
        <div className="px-4 mt-2 mb-1 flex items-center gap-2">
          <div className="flex items-center gap-1 shrink-0">
            <Button type="button" variant={leadSortOrder === "desc" ? "default" : "outline"} size="sm" className="h-7 w-7 px-0" title="Mais recentes primeiro" onClick={() => setLeadSortOrder("desc")} > <ArrowDown className="h-3.5 w-3.5" /> </Button>
            <Button type="button" variant={leadSortOrder === "asc" ? "default" : "outline"} size="sm" className="h-7 w-7 px-0" title="Mais antigas primeiro" onClick={() => setLeadSortOrder("asc")} > <ArrowUp className="h-3.5 w-3.5" /> </Button>
          </div>
          <div className="shrink-0 ml-auto">
            {unreadStats.msgCount > 0 ? (
              <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full font-semibold animate-in fade-in transition-all whitespace-nowrap">
                {unreadStats.convCount} ({unreadStats.msgCount})
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground opacity-70 px-2 py-0.5 whitespace-nowrap">
                Tudo lido 🎉
              </span>
            )}
          </div>
        </div>

        <style>{`.custom-scrollbar::-webkit-scrollbar { width: 6px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(0, 0, 0, 0.1); border-radius: 10px; } .dark .custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(255, 255, 255, 0.1); } `}</style>

        {/* Lista de Leads Refinada */}
        <div ref={leadListRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) { setLeadListLimit((prev) => prev + 60); }
          }}
        >
{!leadCacheLoaded ? (
  <div className="px-1 py-1 space-y-1.5">
    {Array.from({ length: 8 }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 p-2 rounded-lg">
        <div className="h-10 w-10 rounded-full bg-muted/60 animate-pulse shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="h-3 bg-muted/60 animate-pulse rounded" style={{ width: `${45 + (i % 4) * 10}%` }} />
            <div className="h-2.5 w-8 bg-muted/40 animate-pulse rounded" />
          </div>
          <div className="h-2.5 bg-muted/40 animate-pulse rounded" style={{ width: `${55 + (i % 3) * 12}%` }} />
        </div>
      </div>
    ))}
  </div>
) : (
orderedLeads.slice(0, leadListLimit).map((msg) => {
            const jid = msg.remote_jid;
            const lastMsg = lastMessageByLead[jid];

            const unreadAgg = unreadByJid.get(normalizeJid(jid));
            const unreadCount = unreadAgg?.unread_count || 0;
            const isUnread = unreadCount > 0;

            const instanceId = unreadAgg?.instance_id || lastMsg?.instance_id || msg.instance_id || null;
            const key = buildConversationKey(jid, instanceId);
            const shouldPulse = (pulseMap.get(key) || 0) > Date.now() && currentLead !== jid;

            return (
              <div
                key={msg.remote_jid}
                ref={(el) => { leadRowRefMap.current.set(msg.remote_jid, el); }}
                onClick={async () => {
                  // Se long press abriu o menu, não abrir a conversa
                  if (longPressTriggeredRef.current) { longPressTriggeredRef.current = false; return; }
                  if (leadSelectMode) { toggleSelectJid(msg.remote_jid); return; }

                  const jid = msg.remote_jid;
                  setIsSwitchingChat(true);
                  setLeadMeta(null);
                  setShowSummary(false);
                  setCurrentLead(jid);

                  if (search && msg.id) {
                    setTargetMsgId(msg.id);
                  } else {
                    setTargetMsgId(null);
                  }

                  await ensureConversationLoaded(jid);
                  await loadLeadMeta(jid);
                  setLeadInUrl((msg as any).id ?? null, jid);
                  if (isMobile) setShowChat(true);
                  setIsSwitchingChat(false);
                }}
                onContextMenu={(e) => openContextMenu(e, msg.remote_jid)}
                onTouchStart={(e) => handleTouchStart(e, msg.remote_jid)}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchMove}
                className={`
                  relative flex items-center gap-3 p-3 cursor-pointer transition-all border-b border-border/40
                  ${ currentLead === msg.remote_jid ? "bg-muted border-l-[3px] border-l-primary" : isUnread ? "bg-blue-50 dark:bg-blue-900/20 border-l-[3px] border-l-transparent shadow-sm" : "hover:bg-muted/50 border-l-[3px] border-l-transparent" }
                  ${shouldPulse ? "animate-[pulse-soft_2s_infinite]" : ""}
                `}
              >
                {leadSelectMode ? (
                <div className="shrink-0 pt-1">
                  <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={selectedLeadJids.has(msg.remote_jid)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSelectJid(msg.remote_jid)} title="Selecionar lead" />
                </div>
              ) : null}

                {/* 1. AVATAR (Fixo na esquerda) */}
                <div className="relative shrink-0">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className={isUnread ? "bg-primary/10 text-primary font-bold" : ""}>
                      {msg.remote_jid.slice(-2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-0.5 -right-0.5 bg-green-500 rounded-full p-[1.5px] border-2 border-background flex items-center justify-center">
                    <WhatsAppLogo className="w-2.5 h-2.5 text-white" />
                  </div>
                </div>

                {/* 2. CONTEÚDO */}
                <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                  
                  {/* LINHA DE CIMA: Nome + Hora */}
                  <div className="flex justify-between items-center gap-2">
                    <span className={`truncate flex-1 min-w-0 text-[15px] ${ isUnread ? "font-extrabold text-foreground" : "font-semibold text-foreground/80" }`} >
                      {(() => {
  const lead = leadCache[msg.remote_jid] || (leadMeta?.remote_jid === msg.remote_jid ? leadMeta : null);
  
  const cleanJid = msg.remote_jid.replace(/@s\.whatsapp\.net$/i, "").replace(/@g\.us$/i, "");
  // Forçamos o uso do JID real do WhatsApp, ignorando o number_lead do banco que tem o ID do CRM
  const number = cleanJid; 
  const leadName = (lead as any)?.lead_name || "";
  const leadCode = (lead as any)?.lead_code || "";
  
  const mainName = leadName || leadCode || number;
  const subInfo = leadName ? (leadCode || number) : (number !== mainName ? number : "");

  return (
    <>
      {mainName}
      {subInfo && subInfo !== mainName ? ( 
        <span className="ml-2 text-[10px] text-muted-foreground font-normal"> 
          {subInfo} 
        </span> 
      ) : null}
    </>
  );
})()}
                    </span>
                    
                    {/* Renderiza para admin e usuário comum o nome atribuído */}
                    {(() => {
                      const meta = leadCache[msg.remote_jid];
                      const uids: string[] = meta?.assigned_user_ids && Array.isArray(meta.assigned_user_ids) ? meta.assigned_user_ids : meta?.assigned_user_id ? [String(meta.assigned_user_id)] : [];

                      if (!uids.length) {
                        if (isAdmin) {
                          return (
                            <button type="button" title="Clique para gerenciar usuários deste lead" className="text-[10px] text-muted-foreground mt-0.5 hover:text-primary hover:underline text-left cursor-pointer transition-colors w-fit" onClick={(e) => { e.stopPropagation(); openAddUserDialogByJid(msg.remote_jid); }}>
                              📥 Não atribuído
                            </button>
                          );
                        }
                        return <div className="text-[10px] text-muted-foreground mt-0.5 w-fit">📥 Não atribuído</div>;
                      }

                      const names = uids.map((id) => teamUsers.find((t) => t.id === id)?.nome).filter(Boolean) as string[];

                      if (!names.length) {
                        if (isAdmin) {
                          return <button type="button" className="text-[10px] text-muted-foreground mt-0.5 hover:text-primary hover:underline text-left cursor-pointer transition-colors w-fit" onClick={(e) => { e.stopPropagation(); openAddUserDialogByJid(msg.remote_jid); }}>👤 Atribuído</button>;
                        }
                        return <div className="text-[10px] text-muted-foreground mt-0.5 w-fit">👤 Atribuído</div>;
                      }

                      const shown = names.slice(0, 2).join(", ");
                      const extra = names.length > 2 ? ` +${names.length - 2}` : "";
                      const label = `👤 ${shown}${extra}`;

                      if (isAdmin) {
                        return (
                          <button type="button" title="Clique para gerenciar usuários deste lead" className="text-[10px] text-muted-foreground mt-0.5 hover:text-primary hover:underline text-left cursor-pointer transition-colors w-fit" onClick={(e) => { e.stopPropagation(); openAddUserDialogByJid(msg.remote_jid); }}>
                            {label}
                          </button>
                        );
                      }

                      return (
                        <div className="text-[10px] text-muted-foreground mt-0.5 w-fit" title={names.join(", ")}>
                          {label}
                        </div>
                      );
                    })()}

                    <span className={`text-[11px] whitespace-nowrap shrink-0 ${ isUnread ? "text-primary font-bold" : "text-muted-foreground" }`} >
                      {formatListDate(msg.created_at)}
                    </span>
                  </div>

                  {/* LINHA DE BAIXO: Mensagem + Badge Contador */}
                  <div className="flex justify-between items-center gap-2 w-full min-w-0 mt-0.5">
                    <p className={`truncate text-xs flex-1 min-w-0 ${isUnread ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                        {msg.from_me && ( <span className="inline-flex mr-1 align-middle"> {renderAck(msg)} </span> )}
                        {(() => {
                          const type = String(msg.message_type || "").toLowerCase();
                          const text = String(msg.message || "").toLowerCase().trim();

                          // Primeiro checa pelo message (mais preciso quando message_type é genérico)
                          if (text === "audio") return "🎙️ Áudio";
                          if (text === "img" || text === "image") return "📷 Imagem";
                          if (text === "video") return "🎥 Vídeo";
                          if (text === "word" || text === "document") return "📄 Documento";

                          // Fallback pelo message_type (quando message tem conteúdo real)
                          if (type === "audio") return "🎙️ Áudio";
                          if (type === "image") return msg.message || "📷 Imagem";
                          if (type === "video") return msg.message || "🎥 Vídeo";
                          if (type === "document") return msg.message || "📄 Documento";
                          if (type.includes("sticker")) return "🏷️ Sticker";

                          return msg.message || "Mensagem";
                        })()}
                    </p>

                    {unreadCount > 0 && (
                      <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center animate-in zoom-in shadow-sm">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
)}
        </div>
      </div>
)}

      {/* RESIZER (desktop) */}
      {!isMobile && (
        <div onMouseDown={startResizeSidebar} className="hidden lg:flex w-2 cursor-col-resize items-stretch" role="separator" aria-orientation="vertical" title="Arraste para redimensionar" >
          <div className="w-px bg-border/70 hover:bg-zinc-500/60 flex-1 mx-auto" />
        </div>
      )}

      {/* CHAT */}
      {(!isMobile || showChat) && (
        <div 
          className={`flex-1 min-w-0 w-full flex flex-col border rounded-lg relative transition-all ${isDragging ? "ring-2 ring-primary ring-inset bg-primary/5" : ""}`}
          onDragOver={currentLead ? handleDragOver : undefined}
          onDragLeave={currentLead ? handleDragLeave : undefined}
          onDrop={currentLead ? handleDrop : undefined}
        >
          {/* SOBREPOSIÇÃO VISUAL DO DRAG AND DROP */}
          {isDragging && currentLead && (
            <div className="absolute inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg pointer-events-none">
              <div className="flex flex-col items-center gap-2 text-primary">
                <span className="text-5xl drop-shadow-md">📥</span>
                <p className="font-semibold text-lg drop-shadow-md">Solte seus arquivos aqui!</p>
                <p className="text-sm opacity-80">(Imagens, Vídeos, Áudios ou Documentos)</p>
              </div>
            </div>
          )}

          {isSwitchingChat ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 opacity-60">
                <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <span className="text-sm">Carregando conversa…</span>
              </div>
            </div>
          ) : currentLead ? (
            <>
              {/* === BANNER DE SUGESTÃO DE MESCLAGEM (SÓ PARA ADMINS) === */}
              {(isAdmin || isManager) && duplicateLeadSuggestion && (
                <div className="bg-amber-100 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in slide-in-from-top-2">
                  <div className="text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2">
                    <span className="text-xl">⚠️</span>
                    <span>
                      Lead duplicado por variação do 9º dígito.
                      {" "}<b>{duplicateLeadSuggestion.oldLead.lead_name || duplicateLeadSuggestion.oldLead.remote_jid}</b> será mesclado em{" "}
                      <b>{duplicateLeadSuggestion.activeLead.lead_name || duplicateLeadSuggestion.activeLead.remote_jid}</b> (número ativo).
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-100"
                    onClick={() => handleMergeLeads(duplicateLeadSuggestion.activeLead, duplicateLeadSuggestion.oldLead)}
                    disabled={isMerging}
                  >
                    {isMerging ? "Mesclando..." : "Mesclar para o número ativo"}
                  </Button>
                </div>
              )}

              {/* =========================================================
                 TOP META BAR (CABEÇALHO DO CHAT) - RESPONSIVO
                 ========================================================= */}
              <div className="p-3 sm:p-4 border-b flex flex-col gap-3 bg-background/50 backdrop-blur-sm sticky top-0 z-10">
                <div className="flex items-start sm:items-center gap-2 sm:gap-3">
                  
                  {/* ← VOLTAR (mobile) */}
                  {isMobile && (
                    <Button variant="ghost" size="sm" className="px-2 -ml-2 mt-1 sm:mt-0" onClick={() => { setShowChat(false); setCurrentLead(null); setLeadMeta(null); setStages([]); clearChatParamsInUrl(); setJidFromUrlState(null); }} >
                      ←
                    </Button>
                  )}

                  {/* AVATAR — clica pra ver info do lead */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowLeadInfo(true); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowLeadInfo(true); } }}
                    title="Ver informações do lead"
                    aria-label="Ver informações do lead"
                    className="group relative shrink-0 mt-0.5 sm:mt-0 rounded-full cursor-pointer transition hover:ring-2 hover:ring-primary/60 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <Avatar className="h-8 w-8 sm:h-10 sm:w-10">
                      <AvatarFallback className="bg-primary/10 text-primary">{currentLead.slice(-2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary text-[10px] leading-4 text-center text-primary-foreground opacity-0 group-hover:opacity-100 transition shadow">
                      ℹ
                    </span>
                  </div>

                  {/* NOME + CÓDIGO + FUNIL (Responsivo) */}
                  <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                    
                    {/* NOME DO LEAD (Editável) */}
                    {editingLeadCode ? (
                      <Input value={leadCodeDraft} onChange={(e) => setLeadCodeDraft(e.target.value)} autoFocus className="h-8 max-w-[240px] text-sm sm:text-base" onBlur={saveLeadCode} onKeyDown={(e) => { if (e.key === "Enter") saveLeadCode(); }} />
                    ) : (
                      <h3 className="font-semibold text-sm sm:text-base truncate cursor-pointer hover:underline flex items-center gap-2 group" onClick={() => { setLeadCodeDraft(leadMeta?.lead_name || leadMeta?.lead_code || leadMeta?.remote_jid || ""); setEditingLeadCode(true); }} >
                        <span className="truncate">{leadMeta?.lead_name || leadMeta?.lead_code || leadMeta?.remote_jid || currentLead}</span>
                        <span className="text-[10px] opacity-0 group-hover:opacity-40 transition-opacity shrink-0">✎</span>
                      </h3>
                    )}

                    {/* NÚMERO DO LEAD — MOBILE */}
                    <span className="sm:hidden text-[10px] text-muted-foreground truncate">
                      {(leadMeta?.remote_jid || currentLead)?.replace(/@s\.whatsapp\.net$/i, "").replace(/@g\.us$/i, "").replace(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/, "+$1 ($2) $3-$4")}
                    </span>

                   {/* CÓDIGO E NÚMERO DO LEAD (EMPILHADOS) */}
                    <div className="hidden sm:flex flex-col gap-0.5 text-[10px] sm:text-[11px] text-muted-foreground truncate">
                      {leadMeta?.lead_code && (
                        <span title="Código do Lead">Cod: {leadMeta.lead_code}</span>
                      )}
                      
                      {/* Número de Telefone Limpo embaixo */}
                      <span title="Número do WhatsApp" className="font-medium">
                        {(leadMeta?.remote_jid || currentLead)?.replace(/@s\.whatsapp\.net$/i, "").replace(/@g\.us$/i, "")}
                      </span>
                    </div>

                    {/* LINHA DO FUNIL E ETAPA (Responsivo: empilha no mobile, lado a lado no desktop) */}
                    {leadMeta?.current_funnel_id && (
                      <div className="hidden sm:flex flex-col sm:flex-row sm:items-center mt-1 sm:mt-0.5 text-[11px] sm:text-xs leading-tight sm:leading-normal">
                        <div className="flex items-center min-w-0">
                          <span className="text-muted-foreground mr-1 shrink-0">Funil:</span>
                          <span className="font-medium text-foreground truncate">
                            {funnels.find((f) => f.id === leadMeta.current_funnel_id)?.name || "—"}
                          </span>
                        </div>
                        
                        {leadMeta?.current_stage_id && (
                          <div className="flex items-center min-w-0 mt-0.5 sm:mt-0">
                            {/* O pontinho separador só aparece no Desktop (sm) */}
                            <span className="text-muted-foreground/40 hidden sm:inline mx-2 shrink-0">•</span>
                            <span className="text-muted-foreground mr-1 shrink-0">Etapa:</span>
                            <span className="font-semibold text-primary truncate">
                              {stages.find((s) => s.id === leadMeta.current_stage_id)?.name || "Carregando..."}
                            </span>
                          </div>
                        )}
                        
                      </div>
                    )}
                    {/* 🟢 ADICIONE ESTE BLOCO LOGO AQUI: */}
{activeLeadTags.length > 0 && (
  <div className="hidden sm:flex flex-nowrap items-center mt-1 gap-1 overflow-hidden max-w-full">
    <span className="text-muted-foreground text-[10px] sm:text-[11px] mr-0.5">Tags:</span>
    {activeLeadTags.map(tag => (
      <span 
        key={tag.id} 
        className="px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-medium text-white shadow-sm"
        style={{ backgroundColor: tag.color || '#64748b' }}
      >
        {tag.name}
      </span>
    ))}
  </div>
)}
                  </div>

                  {/* Status/trocar fonte agora vive no ícone 📱 ao lado do calendário */}

                  {/* AÇÕES (Tags, Funil, etc) */}
                  <div className="flex flex-row items-center gap-1 shrink-0">
                    <div className="flex items-center gap-1">
                      {/* 🏷 TAGS */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button title="Tags" className="p-1.5 sm:p-2 rounded-md hover:bg-muted transition flex items-center gap-1 text-base sm:text-lg" >
                            🏷
                            <span className="hidden xl:inline text-xs">Tags</span>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72" onClick={(e) => e.stopPropagation()} >
                          {leadMeta?.id ? ( <LeadTagsBox leadId={leadMeta.id} /> ) : ( <div className="text-xs text-center p-2 opacity-50"> Carregando dados do lead... </div> )}
                        </PopoverContent>
                      </Popover>

                      {/* 🔄 FUNIL */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button title="Funil" className="p-1.5 sm:p-2 rounded-md hover:bg-muted transition flex items-center gap-1 text-base sm:text-lg" >
                            🔄
                            <span className="hidden xl:inline text-xs">Funil</span>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 space-y-3 p-4">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Selecionar Funil</label>
                            <Select value={leadMeta?.current_funnel_id ?? ""} onValueChange={(v) => updateLeadFunnel(v || null)} >
                              <SelectTrigger>
                                <SelectValue placeholder="Escolher funil" />
                              </SelectTrigger>
                              <SelectContent>
                                {funnels.filter((f) => f.active).map((f) => ( <SelectItem key={f.id} value={f.id}> {f.name} </SelectItem> ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {stages.length > 0 && (
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-muted-foreground">Selecionar Etapa</label>
                              <Select value={leadMeta?.current_stage_id ?? ""} onValueChange={(v) => updateLeadStage(v || null)} >
                                <SelectTrigger>
                                  <SelectValue placeholder="Escolher etapa" />
                                </SelectTrigger>
                                <SelectContent>
                                  {stages.map((s) => ( <SelectItem key={s.id} value={s.id}> {s.name} </SelectItem> ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>

                      {/* 🏆 BOTÃO DE CONTRATO FECHADO */}
                      <button
                        title="Comemorar Contrato Fechado na TV!"
                        onClick={handleCloseDeal}
                        disabled={isClosingDeal}
                        className="p-1.5 sm:p-2 rounded-md bg-emerald-500 hover:bg-emerald-600 text-white transition flex items-center gap-1 shadow-sm disabled:opacity-50 text-base sm:text-lg"
                      >
                        {isClosingDeal ? "⏳" : "🏆"}
                        <span className="hidden xl:inline text-xs font-bold">Vendeu!</span>
                      </button>

                      {/* 📅 FILTRO POR DATA */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button title="Filtrar por data" className={`p-1.5 sm:p-2 rounded-md hover:bg-muted transition flex items-center gap-1 text-base sm:text-lg ${(messageDateFrom || messageDateTo) ? "bg-primary/10 ring-1 ring-primary/30" : ""}`}>
                            📅
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-80 p-3">
                          <div className="text-xs font-medium mb-2">Filtrar mensagens por data</div>
                          <div className="flex items-center gap-2">
                            <Input type="date" value={messageDateFrom} onChange={(e) => setMessageDateFrom(e.target.value)} className="h-8" />
                            <span className="text-xs opacity-60">até</span>
                            <Input type="date" value={messageDateTo} onChange={(e) => setMessageDateTo(e.target.value)} className="h-8" />
                          </div>
                          <div className="flex items-center justify-between mt-3">
                            <div className="text-[11px] opacity-70">
                              {(messageDateFrom || messageDateTo) ? <>Exibindo {filteredCurrentMessages.length} de {currentMessages.length}</> : <>Sem filtro</>}
                            </div>
                            {(messageDateFrom || messageDateTo) && (
                              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setMessageDateFrom(""); setMessageDateTo(""); }}>
                                <X className="h-3 w-3 mr-1" /> Limpar
                              </Button>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>

                      {/* 📱 TROCAR FONTE/INSTÂNCIA (funciona em qualquer tamanho de tela) */}
                      {instancias.length > 0 && isAdmin && (() => {
                        // Usa a MESMA lógica do envio — assim o que aparece aqui é o que vai ser usado ao enviar.
                        const rawKey = getInstanceForSend() || "";
                        const isValid = instancias.some((i: any) => String(i.instance_key) === String(rawKey));
                        const leadSendKey = isValid && rawKey ? String(rawKey) : undefined;
                        const isInstanceOnline = !!(rawKey && instancias?.some((i: any) => i.instance_key === rawKey && i.status === "CONNECTED"));
                        const currentInst = instancias.find((i: any) => String(i.instance_key) === String(rawKey));
                        const currentInstName = currentInst?.instance_name || rawKey || "—";

                        return (
                          <Popover modal={true}>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                title={`Fonte${rawKey ? `: ${currentInstName}` : ""} — ${isInstanceOnline ? "Online" : "Offline"}. Clique para trocar.`}
                                className="relative p-1.5 sm:p-2 rounded-md hover:bg-muted transition flex flex-col items-center gap-0.5 leading-none"
                              >
                                <span className="relative inline-flex text-base sm:text-lg">
                                  📱
                                  <span
                                    className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background ${
                                      isInstanceOnline ? "bg-emerald-500" : "bg-muted-foreground/60"
                                    }`}
                                  />
                                </span>
                                <span className="text-[10px] text-muted-foreground max-w-[80px] truncate">
                                  {currentInstName}
                                </span>
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-64" onClick={(e) => e.stopPropagation()}>
                              <div className="text-sm font-medium mb-2">Trocar fonte / instância</div>
                              <Select value={leadSendKey} onValueChange={(val) => handleChangeInstance(val)}>
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Selecione..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {instancias.map((inst: any) => {
                                    const keyStr = String(inst.instance_key || inst.id || "");
                                    if (!keyStr) return null;
                                    return (
                                      <SelectItem key={keyStr} value={keyStr}>
                                        {inst.instance_name || keyStr}
                                      </SelectItem>
                                    );
                                  })}
                                </SelectContent>
                              </Select>
                              <div className="text-[11px] opacity-70 mt-2">
                                {isInstanceOnline
                                  ? "Instância atual conectada."
                                  : "Instância offline — selecione uma conectada para enviar mensagens."}
                              </div>
                            </PopoverContent>
                          </Popover>
                        );
                      })()}
                    </div>

                    {/* Fonte agora vive no modal do avatar (clique na bolinha do lead) */}

                    {/* Separador + Lupa de busca na conversa */}
                    <div className="hidden sm:block w-px h-6 bg-border/60 mx-1" />
                    <button
                      type="button"
                      title="Buscar nesta conversa (Ctrl+F)"
                      onClick={() => setChatSearchOpen((v) => !v)}
                      className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                        chatSearchOpen
                          ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <Search className="h-4 w-4" />
                    </button>

                  </div>
                </div>
              </div>

              {/* 🔎 BARRA DE BUSCA NA CONVERSA */}
              {chatSearchOpen && currentLead && (
                <div className="border-b bg-muted/40 px-3 py-2 flex items-center gap-2">
                  <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    autoFocus
                    placeholder="Buscar nesta conversa..."
                    value={chatSearchTerm}
                    onChange={(e) => setChatSearchTerm(e.target.value)}
                    className="h-8 flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (chatSearchMatches.length === 0) return;
                        if (e.shiftKey) {
                          setChatSearchIndex((i) => (i - 1 + chatSearchMatches.length) % chatSearchMatches.length);
                        } else {
                          setChatSearchIndex((i) => (i + 1) % chatSearchMatches.length);
                        }
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setChatSearchOpen(false);
                      }
                    }}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[68px] text-right">
                    {chatSearchTerm.trim() === ""
                      ? ""
                      : chatSearchLoadingDb && chatSearchMatches.length === 0
                      ? "Buscando..."
                      : chatSearchMatches.length === 0
                      ? "Nenhum"
                      : `${chatSearchIndex + 1} de ${chatSearchMatches.length}${chatSearchLoadingDb ? "…" : ""}`}
                  </span>
                  <button
                    type="button"
                    title="Anterior (Shift+Enter)"
                    disabled={chatSearchMatches.length === 0}
                    onClick={() => setChatSearchIndex((i) => (i - 1 + chatSearchMatches.length) % chatSearchMatches.length)}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Próxima (Enter)"
                    disabled={chatSearchMatches.length === 0}
                    onClick={() => setChatSearchIndex((i) => (i + 1) % chatSearchMatches.length)}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Fechar (Esc)"
                    onClick={() => setChatSearchOpen(false)}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-muted"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

{/* LISTA DE MENSAGENS */}
              <ScrollArea className="flex-1 min-w-0" viewportRef={scrollAreaRef}>
                <div className="space-y-4 overflow-x-hidden min-w-0 flex flex-col w-full pl-2 sm:pl-4 pr-4 sm:pr-6 py-4">
                  {canLoadMoreMsgs && (
                    <div className="flex justify-center pb-2">
                      <Button variant="ghost" size="sm" disabled={isLoadingOlderMsgs || isLoadingOlderDb} onClick={async () => {
                          const el = scrollAreaRef.current;
                          if (!el || !currentLead) return;

                          const total = filteredCurrentMessages.length;

                          if (visibleMsgCount < total) {
                            scrollAdjustRef.current = { prevHeight: el.scrollHeight, prevTop: el.scrollTop };
                            setIsLoadingOlderMsgs(true);
                            setVisibleMsgCount((c) => Math.min(c + CHAT_PAGE_SIZE, total));
                            return;
                          }

                          scrollAdjustRef.current = { prevHeight: el.scrollHeight, prevTop: el.scrollTop };
                          await loadOlderMessagesFromDb(currentLead);
                        }}
                      >
                        {(isLoadingOlderMsgs || isLoadingOlderDb) ? "Carregando..." : (canLoadMoreLocal ? "Carregar mensagens anteriores" : "Buscar mais antigas no banco")}
                      </Button>
                    </div>
                  )}
                  {renderedMessages}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* PREVIEW GALERIA (MULTIPLE FILES) */}
              {pendingMedia.length > 0 && (
                <div className="p-3 border-t bg-muted">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">Pré-visualização ({pendingMedia.length})</p>
                    <Button variant="ghost" size="sm" onClick={() => setPendingMedia([])} className="h-6 px-2 text-xs"> Limpar tudo </Button>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
                    {pendingMedia.map((media, idx) => (
  <div key={idx} className={`relative shrink-0 border rounded-md bg-background overflow-hidden group flex items-center justify-center ${media.type === 'audio' ? 'w-64 h-24 px-4' : 'w-24 h-24'}`}>
    <button type="button" className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10" onClick={() => setPendingMedia(prev => prev.filter((_, i) => i !== idx))}>
      <X className="w-3 h-3" />
    </button>
    
    {media.type === "image" && <img src={media.url} className="w-full h-full object-cover cursor-zoom-in" onClick={() => setZoomImageUrl(media.url)} />}
    {media.type === "video" && <video src={media.url} className="w-full h-full object-cover" controls />}
    {media.type === "audio" && (
      <div className="flex flex-col items-center justify-center w-full">
        <audio src={media.url} controls className="w-full h-10 outline-none" />
      </div>
    )}
    {media.type === "document" && <div className="flex flex-col items-center"><span className="text-2xl">📄</span><span className="text-[9px] truncate w-20 text-center mt-1 px-1">{media.file.name}</span></div>}
  </div>
))}
                  </div>
                  {/* Texto junto com a mídia (não aparece para áudio) */}
                  {!pendingMedia.every(m => m.type === "audio") && (
                    <div className="mt-2">
                      <input
                        type="text"
                        value={mediaCaptionText}
                        onChange={(e) => setMediaCaptionText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendPendingMedia(); } }}
                        placeholder="Escreva uma mensagem junto com a mídia (opcional)"
                        className="w-full h-9 rounded-md border bg-background px-3 text-sm placeholder:text-muted-foreground/50"
                        autoFocus
                      />
                    </div>
                  )}
                  <div className="flex justify-end gap-2 mt-2">
                    <Button variant="outline" size="sm" onClick={() => { setPendingMedia([]); setMediaCaptionText(""); }}>Cancelar</Button>
                    <Button size="sm" onClick={sendPendingMedia}>Enviar {pendingMedia.length > 1 ? `${pendingMedia.length} mídias` : ""}</Button>
                  </div>
                </div>
              )}

              {/* Fade de fim de conversa */}
              <div className="pointer-events-none h-6 -mt-6 relative z-[1] bg-gradient-to-t from-background to-transparent" />

              {/* INPUT */}
              {replyingTo && (
                <div className="flex items-center justify-between bg-muted/50 px-4 py-2 border-l-4 border-primary mb-1 mx-2 rounded-r animate-in slide-in-from-bottom-2 overflow-hidden max-w-full">
                  <div className="flex flex-col overflow-hidden min-w-0 flex-1 pr-2">
                    <span className="text-xs font-bold text-primary mb-0.5 truncate"> {replyingTo.from_me ? "Atendente" : leadMeta?.lead_name || leadMeta?.lead_code || currentLead} </span>
                    <span className="text-xs truncate text-muted-foreground max-w-full"> {getReplyPreview(replyingTo)} </span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setReplyingTo(null)} >
                    <X className="h-4 w-4 opacity-70" />
                  </Button>
                </div>
              )}
              <div className="border-t bg-background px-2 py-2 sm:px-4">
                <div className="flex items-end gap-2">
                  {/* 🎙️ Gravação */}
                  {isRecording ? (
                    <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-red-500 bg-red-500/10">
                      <RecordingWaveBars levels={audioLevels} />
                      <span className="text-sm font-semibold text-red-600"> {formatTime(recordingTime)} </span>
                      <Button variant="destructive" size="sm" onClick={stopRecording} > ⏹️ </Button>
                      <Button variant="outline" size="sm" onClick={cancelRecording} title="Cancelar Gravação"> ❌ </Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="icon" className="shrink-0 rounded-full h-10 w-10" onClick={startRecording} title="Gravar áudio" > 🎙️ </Button>
                  )}

                  {/* 📎 + Campo de texto */}
                  <div className="flex-1 flex items-end gap-2 rounded-2xl border bg-muted px-3 py-2">
                    <div className="relative">
                      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setShowMediaMenu((v) => !v)} title="Enviar mídia" > 📎 </Button>
                      {showMediaMenu && (
                        <div className="absolute bottom-full mb-2 left-0 bg-background border rounded-lg shadow-lg z-50 w-44">
                          {(Object.keys(MEDIA_CONFIG) as MediaType[]).map(
                            (type) => (
                              <button key={type} className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition"
                                onClick={() => {
                                  if (fileInputRef.current) {
                                    fileInputRef.current.accept = type === 'video' ? 'video/mp4' : MEDIA_CONFIG[type].accept;
                                    fileInputRef.current.click();
                                  }
                                  setShowMediaMenu(false);
                                }}
                              >
                                {MEDIA_CONFIG[type].label}
                              </button>
                            )
                          )}
                        </div>
                      )}
                    </div>

                    {/* 📋 Template (YCloud) */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => setShowSendTemplate(true)}
                      title="Enviar template (WhatsApp Business API)"
                      type="button"
                    >
                      📋
                    </Button>

                    {/* 😀 EMOJIS CATEGORIZADOS */}
                    <Popover open={openEmojiPicker} onOpenChange={setOpenEmojiPicker}>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-9 w-9" title="Emojis"> 
                          <Smile className="h-4 w-4" /> 
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent side="top" align="start" sideOffset={10} className="w-80 p-0 overflow-hidden flex flex-col h-80">
                        {/* Cabeçalho do seletor */}
                        <div className="bg-muted px-3 py-2 border-b text-xs font-semibold">
                          Seletor de Emojis
                        </div>
                        
                        {/* Área de rolagem com as categorias */}
                        <ScrollArea className="flex-1 p-3 custom-scrollbar">
                          <div className="space-y-4">
                            {EMOJI_CATEGORIES.map((category, idx) => (
                              <div key={idx}>
                                <h4 className="text-[11px] font-medium text-muted-foreground mb-1 ml-1 uppercase tracking-wider">
                                  {category.title}
                                </h4>
                                <div className="grid grid-cols-8 gap-1">
                                  {category.emojis.map((emoji, eIdx) => (
                                    <button 
                                      key={`${emoji}-${eIdx}`} 
                                      type="button" 
                                      className="h-8 w-8 rounded hover:bg-muted transition flex items-center justify-center text-[19px] hover:scale-110" 
                                      onClick={() => { insertEmojiAtCursor(emoji); setOpenEmojiPicker(false); }} 
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </PopoverContent>
                    </Popover>
                    
                    {/* ⚡ MENSAGENS PRONTAS */}
                    <QuickMessagesPopover
                      companyId={companyId}
                      userId={user?.id}
                      leadName={(leadMeta as any)?.lead_name || (leadMeta as any)?.lead_code}
                      onSelect={(msg) => {
                        setText((prev) => (prev ? `${prev} ${msg}` : msg));
                        setTimeout(() => inputRef.current?.focus(), 50);
                      }}
                    />

                    {/* ✅ CAMPO DE TEXTO */}
                    <Textarea
                      ref={inputRef}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={1}
                      placeholder={pendingMedia.length > 0 ? "Envie a mídia acima para continuar" : "Digite sua mensagem"}
                      className={`resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 min-h-[44px] max-h-[120px] ${pendingMedia.length > 0 ? "opacity-30 pointer-events-none" : ""}`}
                      disabled={pendingMedia.length > 0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && sendWithEnter && pendingMedia.length === 0) { e.preventDefault(); sendMessage(); }
                      }}
                    />

                    {/* ∞ INFINITY BOT (balão) */}
                    <div className="relative">
                      <Button size="icon" variant="outline" title="InfinityBot" onClick={() => { if (openInfinityBot) { startCloseInfinityBot(); } else { setBotClosing(false); setOpenInfinityBot(true); } }} className="shrink-0 rounded-full h-9 w-9 border-primary/20 text-primary hover:bg-primary hover:text-primary-foreground transition-colors" >
                        <span className="font-bold">∞</span>
                      </Button>

                      {(openInfinityBot || botClosing) && (
                        <>
                          <div className={`fixed inset-0 z-[70] bg-black/10 backdrop-blur-sm ${ botClosing ? "animate-out fade-out-0" : "animate-in fade-in-0" }`} onMouseDown={(e) => { e.preventDefault(); startCloseInfinityBot(); }} />

                          <div className={`absolute bottom-full right-0 mb-2 z-[80] w-[min(88vw,360px)] h-[min(62dvh,480px)] rounded-2xl border bg-background/95 shadow-xl overflow-hidden origin-bottom-right transform-gpu ${ botClosing ? "animate-out fade-out-0 zoom-out-95 slide-out-to-bottom-2" : "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2" }`} onMouseDown={(e) => e.stopPropagation()} >
                            <div className="absolute -bottom-2 right-4 h-4 w-4 rotate-45 bg-background/95 border border-t-0 border-l-0" />

                            <button type="button" className="absolute top-2 right-2 z-10 rounded-full bg-background/80 backdrop-blur border p-1.5 hover:bg-muted" onClick={() => startCloseInfinityBot()} aria-label="Fechar" >
                              <X className="h-4 w-4" />
                            </button>

                            <div className="h-full w-full">
                              <Suspense fallback={<div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">Carregando…</div>}>
                                <InfinityBotSheet
                                  open={openInfinityBot}
                                  onOpenChange={(v) => { if (!v) startCloseInfinityBot(); else setOpenInfinityBot(true); }}
                                  leadId={leadMeta?.id ?? null}
                                  leadDisplay={ (leadMeta as any)?.lead_name || (leadMeta as any)?.lead_code || (leadMeta as any)?.number_lead || (leadMeta as any)?.remote_jid || currentLead || "Lead" }
                                  remoteJid={currentLead || ""}
                                  instanceId={selectedInstanceId || (leadMeta as any)?.instance_id || (Array.isArray(instancias) ? instancias.find((i: any) => i.is_default)?.instance_key : null) || null}
                                  botIconSrc={infinityBotIcon}
                                  summaryText={leadMeta?.chat_summary || ""}
                                  summaryUpdatedAt={leadMeta?.chat_summary_updated_at || null}
                                  summaryHtmlUrl={(leadMeta as any)?.chat_summary_html_url || null}
                                  onGenerateSummary={requestConversationSummary}
                                  onGenerateSummaryHtml={generateSummaryHtml}
                                />
                              </Suspense>
                            </div>
                          </div>
                        </>
                      )}
                    </div>


                    <Button size="icon" className="shrink-0 rounded-full h-9 w-9" onClick={sendMessage} disabled={pendingMedia.length > 0 || (!text.trim() && !forwardingMessage)} >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Enviar com Enter */}
              <div className="hidden sm:flex px-4 pb-1 pt-0.5 text-[10px] text-muted-foreground/50">
                <label className="flex items-center gap-1.5 cursor-pointer hover:text-muted-foreground transition">
                  <input type="checkbox" checked={sendWithEnter} onChange={(e) => setSendWithEnter(e.target.checked)} className="h-3 w-3 rounded" />
                  Enviar com Enter
                </label>
              </div>

              {/* MODAL DE GALERIA INTELIGENTE */}
{zoomImageUrl && (() => {
  // 1. Filtra todas as imagens e vídeos da conversa atual
  const chatMediaItems = currentMessages
    .filter(m => {
      const type = String(m.message_type || "").toLowerCase();
      const url = m.media_url || m._local_preview_url || "";
      // Pega mídias pelo tipo ou pela extensão do arquivo
      return type === "image" || type === "video" || url.match(/\.(jpg|jpeg|png|webp|mp4|mov|webm)$/i);
    })
    .map(m => m.media_url || m._local_preview_url)
    .filter(Boolean) as string[];

  // Remove duplicatas (caso haja) e acha onde a imagem atual está na lista
  const uniqueMediaItems = Array.from(new Set(chatMediaItems));
  const currentIndex = uniqueMediaItems.indexOf(zoomImageUrl);
  const isVideo = zoomImageUrl.toLowerCase().match(/\.(mp4|mov|webm)$/i);

  // Controle pelo teclado (Setas para o lado e Esc para sair)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" && currentIndex > 0) {
      setZoomImageUrl(uniqueMediaItems[currentIndex - 1]);
    } else if (e.key === "ArrowRight" && currentIndex < uniqueMediaItems.length - 1) {
      setZoomImageUrl(uniqueMediaItems[currentIndex + 1]);
    } else if (e.key === "Escape") {
      setZoomImageUrl(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm outline-none"
      onClick={() => setZoomImageUrl(null)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      ref={(el) => el?.focus()} // Dá foco automático para o teclado funcionar na hora
    >
      {/* Botão Fechar */}
      <button className="absolute top-4 right-4 bg-black/50 text-white rounded-full p-2 hover:bg-black/80 z-50 transition" onClick={() => setZoomImageUrl(null)}> 
        <X className="h-6 w-6" /> 
      </button>

      {/* Seta para a Esquerda */}
      {currentIndex > 0 && (
        <button 
          className="absolute left-2 sm:left-8 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full h-12 w-12 flex items-center justify-center hover:bg-black/80 z-50 transition" 
          onClick={(e) => { e.stopPropagation(); setZoomImageUrl(uniqueMediaItems[currentIndex - 1]); }}
          title="Anterior"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
      )}

      {/* Mídia Central (Imagem ou Vídeo) */}
      <div className="relative max-w-full max-h-full flex flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video src={zoomImageUrl} controls autoPlay className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl" />
        ) : (
          <div
            ref={zoomContainerRef}
            className="relative overflow-hidden rounded-md shadow-2xl"
            style={{ cursor: imgZoom > 1 ? (imgDragging ? "grabbing" : "grab") : "zoom-in" }}
            onWheel={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              const mouseX = e.clientX - rect.left - rect.width / 2;
              const mouseY = e.clientY - rect.top - rect.height / 2;
              const delta = e.deltaY > 0 ? -0.15 : 0.15;
              const newZoom = Math.max(0.5, Math.min(5, imgZoom + delta));
              const scale = newZoom / imgZoom;
              setImgPos(prev => ({
                x: mouseX - scale * (mouseX - prev.x),
                y: mouseY - scale * (mouseY - prev.y),
              }));
              setImgZoom(newZoom);
              if (newZoom <= 1) setImgPos({ x: 0, y: 0 });
            }}
            onMouseDown={(e) => { if (imgZoom <= 1) return; setImgDragging(true); imgDragStart.current = { x: e.clientX, y: e.clientY, posX: imgPos.x, posY: imgPos.y }; }}
            onMouseMove={(e) => { if (!imgDragging) return; setImgPos({ x: imgDragStart.current.posX + (e.clientX - imgDragStart.current.x), y: imgDragStart.current.posY + (e.clientY - imgDragStart.current.y) }); }}
            onMouseUp={() => setImgDragging(false)}
            onMouseLeave={() => setImgDragging(false)}
            onDoubleClick={() => { if (imgZoom > 1) { setImgZoom(1); setImgPos({ x: 0, y: 0 }); } else { setImgZoom(2.5); } }}
          >
            <img
              src={zoomImageUrl}
              className="max-w-full max-h-[85vh] object-contain select-none"
              draggable={false}
              style={{
                transform: `scale(${imgZoom}) translate(${imgPos.x / imgZoom}px, ${imgPos.y / imgZoom}px)`,
                transition: imgDragging ? "none" : "transform 0.15s ease-out",
              }}
            />
            {imgZoom !== 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 px-3 py-1 rounded-full text-white text-xs font-medium">
                {Math.round(imgZoom * 100)}%
              </div>
            )}
          </div>
        )}

        {/* Contador de Mídias (Ex: 1 de 5) */}
        {uniqueMediaItems.length > 1 && (
          <div className="absolute -bottom-8 bg-black/50 px-3 py-1 rounded-full text-white/90 text-xs font-medium">
            {currentIndex + 1} de {uniqueMediaItems.length}
          </div>
        )}
      </div>

      {/* Seta para a Direita */}
      {currentIndex < uniqueMediaItems.length - 1 && (
        <button 
          className="absolute right-2 sm:right-8 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full h-12 w-12 flex items-center justify-center hover:bg-black/80 z-50 transition" 
          onClick={(e) => { e.stopPropagation(); setZoomImageUrl(uniqueMediaItems[currentIndex + 1]); }}
          title="Próxima"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      )}

    </div>
  );
})()}
            
      {/* MODAL DE ENCAMINHAMENTO */}
{forwardingMessage && (
  <Dialog 
    open={true} 
    onOpenChange={(isOpen) => { 
      if (!isOpen) { 
        setForwardingMessage(null); 
        setForwardSelectedJids(new Set()); 
        setForwardSearch(""); 
      } 
    }}
  >
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Encaminhar Mensagem</DialogTitle>
      </DialogHeader>

      {/* Preview do que está sendo encaminhado */}
      <div className="bg-muted p-3 rounded-lg text-sm mb-2 border border-border/50 max-h-24 overflow-hidden relative">
        <div className="font-semibold text-xs text-muted-foreground mb-1 flex items-center gap-1">
          <Forward className="w-3 h-3"/> Pré-visualização:
        </div>
        {forwardingMessage.message_type === "image" || forwardingMessage.media_url?.match(/\.(jpg|jpeg|png|webp)$/i) ? "📷 Imagem selecionada" :
         forwardingMessage.message_type === "video" || forwardingMessage.media_url?.match(/\.(mp4|mov|webm)$/i) ? "🎥 Vídeo selecionado" :
         forwardingMessage.message_type === "audio" ? "🎙️ Áudio selecionado" :
         forwardingMessage.message_type === "document" ? "📄 Documento selecionado" :
         <span className="line-clamp-2">{forwardingMessage.message}</span>}
      </div>

      <Input 
        placeholder="Buscar contato..." 
        value={forwardSearch} 
        onChange={(e) => setForwardSearch(e.target.value)} 
        className="mb-2"
      />

      {/* Lista de Contatos */}
      <ScrollArea className="h-60 border rounded-md p-2">
        {Object.entries(leadCache || {})
          .filter(([jid, meta]) => {
            // 1. Respeita as regras de permissão (ocultos e atribuição)
            if (!isAdmin && hiddenJids.has(jid)) return false;
            if (!isAdmin && myUserId) {
              const uids = Array.isArray(meta?.assigned_user_ids) ? meta.assigned_user_ids : (meta?.assigned_user_id ? [String(meta.assigned_user_id)] : []);
              if (!uids.includes(myUserId) && String(meta?.assigned_user_id) !== myUserId) return false;
            }

            // 2. Aplica APENAS a busca do próprio modal de encaminhar
            const searchStr = forwardSearch.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const name = String(meta?.lead_name || meta?.lead_code || jid).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            
            return name.includes(searchStr);
          })
          .sort(([jidA, metaA], [jidB, metaB]) => {
            // Opcional: Organiza por ordem alfabética para facilitar
            const nameA = String(metaA?.lead_name || metaA?.lead_code || jidA).toLowerCase();
            const nameB = String(metaB?.lead_name || metaB?.lead_code || jidB).toLowerCase();
            return nameA.localeCompare(nameB);
          })
          .map(([jid, meta]) => {
            const name = meta?.lead_name || meta?.lead_code || jid.replace(/@s\.whatsapp\.net$/i, "");
            const isSelected = forwardSelectedJids.has(jid);

            return (
              <div 
                key={jid} 
                className="flex items-center gap-3 p-2 hover:bg-muted cursor-pointer rounded-md transition"
                onClick={() => {
                  setForwardSelectedJids(prev => {
                    const next = new Set(prev);
                    if (next.has(jid)) next.delete(jid);
                    else next.add(jid);
                    return next;
                  });
                }}
              >
                <input 
                  type="checkbox" 
                  checked={isSelected} 
                  readOnly 
                  className="w-4 h-4 accent-primary pointer-events-none"
                />
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                    {name.slice(0,2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium truncate">{name}</span>
              </div>
            );
        })}
      </ScrollArea>

      <div className="flex justify-between items-center mt-4">
        <span className="text-xs text-muted-foreground">
          {forwardSelectedJids.size} contato(s) selecionado(s)
        </span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setForwardingMessage(null); setForwardSelectedJids(new Set()); }} disabled={isForwarding}>
            Cancelar
          </Button>
          <Button 
            disabled={forwardSelectedJids.size === 0 || isForwarding}
            onClick={async () => {
              if (forwardSelectedJids.size === 0 || !companyId) return;
              setIsForwarding(true);

              try {
                const fallbackInstanceIdForSend = instancias.find((i) => i.is_default)?.instance_key ?? null;
                const instanceId = getInstanceForSend() || fallbackInstanceIdForSend || "";

                // === CORREÇÃO: Resgatando os dados completos da instância ===
                const inst = instancias.find((i: any) =>
                  i.instance_key === instanceId ||
                  i.id === instanceId ||
                  String(i.phone_number) === String(instanceId)
                );

                const finalInstanceKey = inst?.instance_key || instanceId;
                const finalPhoneNumber = inst?.phone_number ? String(inst.phone_number) : "";
                const finalInstanceId  = inst?.id || "";
                // ============================================================

                // Verifica se é mídia
                const type = String(forwardingMessage.message_type || "text").toLowerCase();
                const isMedia = ["image", "video", "audio", "document"].includes(type) || !!forwardingMessage.media_url;

                // Loop para enviar para os contatos selecionados
                for (const targetJid of Array.from(forwardSelectedJids)) {
                  const localClientId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
                  const localCreatedAt = new Date().toISOString();

                  if (isMedia) {
                    const mediaUrl = forwardingMessage.media_url || forwardingMessage._local_preview_url;
                    if (!mediaUrl) continue;
                    
                    // Transforma a URL da mídia num arquivo para o n8n
                    const res = await fetch(mediaUrl);
                    const blob = await res.blob();
                    const ext = mediaUrl.split('.').pop()?.split('?')[0] || "bin";
                    const file = new File([blob], `encaminhado.${ext}`, { type: blob.type });

                    // --- NOVA LÓGICA AQUI ---
                    let finalForwardType = type;
                    if (type === "document" && (ext === "doc" || ext === "docx")) {
                      finalForwardType = "word";
                    }
                    // ------------------------

                    const fd = new FormData();
                    fd.append("file", file);
                    fd.append("type", finalForwardType); // Atualizado
                    fd.append("media_type", finalForwardType); // Atualizado
                    fd.append("number", targetJid);
                    fd.append("text", forwardingMessage.message || "");
                    fd.append("caption", forwardingMessage.message || "");
                    fd.append("mimetype", blob.type);
                                      
                    // === CORREÇÃO AQUI (Injetando todas as chaves no FormData) ===
                    fd.append("instance_key", finalInstanceKey);
                    fd.append("instance_phone_number", finalPhoneNumber);
                    fd.append("instance_id", finalInstanceId);
                    fd.append("company_id", String(companyId));
                    fd.append("sent_by_name", mySenderName);
                    fd.append("sent_by_role", isAdmin ? "admin" : "user");
                    fd.append("sent_by_user_id", String((user as any)?.id ?? ""));
                    fd.append("local_client_id", localClientId);
                    fd.append("sent_at", localCreatedAt);
                    // ============================================================

                    const webhookUrl = (import.meta.env.VITE_INBOX_MEDIA_WEBHOOK_URL as string) || (import.meta.env.VITE_INBOX_TEXT_WEBHOOK_URL as string) || "https://infnitycrm.zapcompany.com.br/webhook/enviosmidiacrm";
                    await fetch(webhookUrl, { method: "POST", body: fd });

                  } else {
                    // Texto normal
                    // === CORREÇÃO AQUI (Injetando no JSON do texto) ===
                    const payload = {
                      number: targetJid,
                      text: forwardingMessage.message,
                      local_client_id: localClientId,
                      sent_at: localCreatedAt,
                      company_id: companyId,
                      sent_by_name: mySenderName,
                      sent_by_role: isAdmin ? "admin" : "user",
                      sent_by_user_id: (user as any)?.id ?? null,
                      raw_payload: {
                        local_client_id: localClientId,
                        sent_at: localCreatedAt,
                        sent_by_name: mySenderName,
                        sent_by_role: isAdmin ? "admin" : "user",
                        sent_by_user_id: (user as any)?.id ?? null,
                      }
                    };
                    // Usando o finalInstanceKey para garantir o envio correto
                    await __sendTextWebhook(instancias as any, finalInstanceKey, payload);
                    // ============================================================
                  }
                }
                
                alert("Encaminhado com sucesso!");
                setForwardingMessage(null);
                setForwardSelectedJids(new Set());
              } catch (e) {
                console.error("Erro ao encaminhar", e);
                alert("Ocorreu um erro ao encaminhar a mensagem.");
              } finally {
                setIsForwarding(false);
              }
            }}
          >
            {isForwarding ? "Enviando..." : "Encaminhar"} <Forward className="w-4 h-4 ml-2"/>
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
)}

            </>
          ) : (
            <InboxEmptyState />
          )}
        </div>
      )}
      

      {/* DIALOG: OCULTOS (usuário) */}
        <HiddenConversationsDialog
          isAdmin={isAdmin}
          showHiddenDialog={showHiddenDialog}
          setShowHiddenDialog={setShowHiddenDialog}
          hiddenJids={hiddenJids}
          leadCache={leadCache}
          unhideConversationForUser={unhideConversationForUser}
        />

      {/* MENU: CONVERSA */}
      <ConversationContextMenu
        contextMenu={contextMenu}
        isAdmin={isAdmin}
        markConversationAsRead={markConversationAsRead}
        markConversationAsUnread={markConversationAsUnread}
        deleteConversation={deleteConversation}
        hideConversationForUser={hideConversationForUser}
        openAddUserDialogByJid={openAddUserDialogByJid}
        setContextMenu={setContextMenu}
      />

      {/* DIALOG DE ADICIONAR USUÁRIO AGORA FICA AQUI, SOLTO NA TELA! */}
      <AddUserDialog
        addUserLead={addUserLead}
        setAddUserLead={setAddUserLead}
        setAddUserSelectedId={setAddUserSelectedId}
        setAddUserCurrentIds={setAddUserCurrentIds}
        addUserCurrentIds={addUserCurrentIds}
        teamUsers={teamUsers}
        isAdmin={isAdmin}
        removeUserFromLead={removeUserFromLead}
        addUserSelectedId={addUserSelectedId}
        addUserToLead={addUserToLead}
      />
      
      {/* Input de arquivo oculto para anexar mídias */}
      <input type="file" className="hidden" ref={fileInputRef} onChange={handleFileChange} multiple />

      {/* Modal: enviar template (WhatsApp Business API / YCloud) */}
      {companyId && currentLead && (
        <SendTemplateDialog
          open={showSendTemplate}
          onOpenChange={setShowSendTemplate}
          companyId={String(companyId)}
          to={currentLead}
          onSent={(info) => {
            // Optimistic insert (o proxy ja inseriu via INSERT, realtime vai dedup pelo client_id)
            const localCreatedAt = new Date().toISOString();
            setMessages((prev) => [
              ...prev,
              {
                id: `local:tpl:${info.clientId}`,
                remote_jid: currentLead,
                instance_id: "",
                company_id: String(companyId),
                from_me: true,
                message: info.renderedBody,
                message_type: "template",
                created_at: localCreatedAt,
                media_url: null,
                message_id: info.wamid || null,
                raw_payload: {
                  local_client_id: info.clientId,
                  client_id: info.clientId,
                  template_name: info.templateName,
                },
                wa_sent_at: localCreatedAt,
                wa_delivered_at: null,
                wa_read_at: null,
                ack: 1,
                _local_status: "pending",
                _local_client_id: info.clientId,
              } as any,
            ]);
          }}
        />
      )}

      {/* DIALOG: INFORMAÇÕES DO LEAD (abre ao clicar no avatar do topo do chat) */}
      <Dialog open={showLeadInfo} onOpenChange={setShowLeadInfo}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Informações do lead</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm">
            <div className="flex items-center gap-3 pb-3 border-b">
              <Avatar className="h-14 w-14">
                <AvatarFallback className="bg-primary/10 text-primary text-lg">
                  {String(leadMeta?.lead_name || currentLead || "??").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-base truncate">
                  {leadMeta?.lead_name || leadMeta?.lead_code || String(leadMeta?.remote_jid || currentLead || "").replace(/@s\.whatsapp\.net$/i, "").replace(/@g\.us$/i, "") || "Sem nome"}
                </div>
                {leadMeta?.lead_code && leadMeta?.lead_code !== leadMeta?.lead_name && (
                  <div className="text-xs text-muted-foreground truncate">Cod: {leadMeta.lead_code}</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="text-muted-foreground">WhatsApp</div>
              <div className="col-span-2 font-medium break-all">
                {String(leadMeta?.remote_jid || currentLead || "").replace(/@s\.whatsapp\.net$/i, "").replace(/@g\.us$/i, "") || "—"}
              </div>

              <div className="text-muted-foreground">Email</div>
              <div className="col-span-2 break-all">
                {(leadMeta as any)?.email ? (
                  <a href={`mailto:${(leadMeta as any).email}`} className="text-primary hover:underline">
                    {(leadMeta as any).email}
                  </a>
                ) : (
                  <span className="text-muted-foreground italic">—</span>
                )}
              </div>

              <div className="text-muted-foreground">Funil</div>
              <div className="col-span-2">
                {leadMeta?.current_funnel_id
                  ? (funnels.find((f: any) => f.id === leadMeta.current_funnel_id)?.name || "—")
                  : <span className="text-muted-foreground italic">—</span>}
              </div>

              <div className="text-muted-foreground">Etapa</div>
              <div className="col-span-2">
                {leadMeta?.current_stage_id
                  ? (stages.find((s: any) => s.id === leadMeta.current_stage_id)?.name || "—")
                  : <span className="text-muted-foreground italic">—</span>}
              </div>

              <div className="text-muted-foreground">Fonte</div>
              <div className="col-span-2 break-all">
                {leadFonteInfo?.display || (leadMeta as any)?.source || <span className="text-muted-foreground italic">—</span>}
              </div>

              <div className="text-muted-foreground">Instância</div>
              <div className="col-span-2 break-all">
                {(leadMeta as any)?.send_instance_key || (leadMeta as any)?.instance_key || <span className="text-muted-foreground italic">—</span>}
              </div>

              {activeLeadTags?.length > 0 && (
                <>
                  <div className="text-muted-foreground">Tags</div>
                  <div className="col-span-2 flex flex-wrap gap-1">
                    {activeLeadTags.map((tag: any) => (
                      <span
                        key={tag.id}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white shadow-sm"
                        style={{ backgroundColor: tag.color || "#64748b" }}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                </>
              )}

              {(leadMeta as any)?.created_at && (
                <>
                  <div className="text-muted-foreground">Criado em</div>
                  <div className="col-span-2">
                    {(() => {
                      try { return new Date((leadMeta as any).created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }
                      catch { return "—"; }
                    })()}
                  </div>
                </>
              )}

              {(leadMeta as any)?.last_message_at && (
                <>
                  <div className="text-muted-foreground">Última msg</div>
                  <div className="col-span-2">
                    {(() => {
                      try { return new Date((leadMeta as any).last_message_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }
                      catch { return "—"; }
                    })()}
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-3 border-t">
              {(leadMeta as any)?.email && (
                <Button asChild variant="outline" size="sm">
                  <a href={`mailto:${(leadMeta as any).email}`}>Enviar email</a>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const phone = String(leadMeta?.remote_jid || currentLead || "").replace(/@s\.whatsapp\.net$/i, "").replace(/@g\.us$/i, "");
                  if (phone) navigator.clipboard.writeText(phone);
                }}
              >
                Copiar telefone
              </Button>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setShowLeadInfo(false)}>
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}