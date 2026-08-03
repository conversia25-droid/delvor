import { useEffect, useRef, useState } from "react";
import { UserPlus, ClipboardList, Bell, Volume2, VolumeX } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type NotificationType = "lead_assigned" | "task_created" | (string & {});

interface NotificationEvent {
  type: NotificationType;
  title?: string;
  description?: string;
  target_user_id?: string;

  /**
   * ID do registro na tabela notifications (quando vier do realtime).
   * Mantivemos o nome `id` para compatibilidade com eventos antigos.
   */
  id?: string;

  /**
   * Metadata opcional (ex.: { remote_jid, task_id, lead_id, href }).
   * O Sidebar já usa n.meta.remote_jid / n.meta.task_id.
   */
  meta?: any;
}

interface ToastNotification extends Omit<NotificationEvent, "id"> {
  /** id interno do toast */
  id: string;
  /** id do registro na tabela notifications (se existir) */
  source_id?: string;
  visible: boolean;
}

function makeId() {
  // ✅ evita crash em ambientes onde crypto.randomUUID não existe
  const rand = Math.random().toString(16).slice(2);
  return `${Date.now()}-${rand}`;
}

function pickMetaValue(meta: any, keys: string[]): string {
  if (!meta) return "";
  for (const k of keys) {
    const v = meta?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

// Pedir permissão para notificações nativas do OS
function requestNativePermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function showNativeNotification(title: string, body?: string, onClick?: () => void) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  // Só mostra quando a aba NÃO está focada
  if (document.visibilityState === "visible") return;

  try {
    const n = new Notification(title, {
      body: body || "",
      icon: "/logo192.png",
      badge: "/logo192.png",
      tag: `crm-${Date.now()}`,
    });
    n.onclick = () => {
      window.focus();
      n.close();
      if (onClick) onClick();
    };
    // Auto-fechar após 6 segundos
    setTimeout(() => n.close(), 6000);
  } catch {
    // ignore - some browsers block Notification in certain contexts
  }
}

export function NotificationToast() {
  const location = useLocation();
  // Página de TV não deve exibir nenhuma notificação pop-up
  if (location.pathname.startsWith("/tv")) return null;

  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const navigate = useNavigate();

  // Pedir permissão para notificações nativas ao montar
  useEffect(() => {
    requestNativePermission();
  }, []);

  // 🔇 Mute de som das notificações (persistido)
  const [soundMuted, setSoundMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("crm:soundMuted") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("crm:soundMuted", soundMuted ? "1" : "0");
    } catch {
      // ignore
    }
  }, [soundMuted]);
  // 🔄 Sincroniza mute quando mudar em outro lugar (ex.: sininho/Sidebar)
  useEffect(() => {
    const onMuted = (e: Event) => {
      const ev = e as CustomEvent<any>;
      const muted = !!ev.detail?.muted;
      setSoundMuted(muted);
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === "crm:soundMuted") {
        setSoundMuted(e.newValue === "1");
      }
    };

    window.addEventListener("crm-sound-muted-changed", onMuted as any);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("crm-sound-muted-changed", onMuted as any);
      window.removeEventListener("storage", onStorage);
    };
  }, []);


  // 🔔 Som de notificação (precisa de interação do usuário para desbloquear)
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);

  // ⚠️ IMPORTANTE: este componente precisa estar dentro do AuthProvider
  const { user } = useAuth();
  const companyId = user?.company_id || null;
  const userId = user?.id || null;

  // dedupe para evitar duplicar (realtime + evento manual, etc.)
  const seenIds = useRef<Set<string>>(new Set());

  // Inicializa o áudio 1x
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!audioRef.current) {
      audioRef.current = new Audio("/sounds/ding.mp3");
      audioRef.current.preload = "auto";
    }

    // desbloqueia áudio após 1ª interação do usuário
    const unlock = () => {
      if (audioUnlockedRef.current) return;
      audioUnlockedRef.current = true;

      const a = audioRef.current;
      if (!a) return;

      try {
        const prevVol = a.volume;
        a.volume = 0;
        const p = a.play();
        if (p && typeof (p as any).then === "function") {
          (p as Promise<void>)
            .then(() => {
              a.pause();
              a.currentTime = 0;
              a.volume = prevVol;
            })
            .catch(() => {
              a.volume = prevVol;
            });
        } else {
          a.pause();
          a.currentTime = 0;
          a.volume = prevVol;
        }
      } catch {
        // ignore
      }

      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };

    window.addEventListener("pointerdown", unlock, { once: true } as any);
    window.addEventListener("keydown", unlock, { once: true } as any);
    window.addEventListener("touchstart", unlock, { once: true } as any);

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  function shouldPlaySound(detail: NotificationEvent) {
    const t = (detail?.type || "").toString();
    if (t === "chat") return true;
    if (t === "task") return true;
    if (t.startsWith("task_")) return true;
    return false;
  }

  function playSound() {
    if (soundMuted) return;
    const a = audioRef.current;
    if (!a) return;
    // respeita bloqueio de autoplay
    if (!audioUnlockedRef.current) return;
    try {
      a.currentTime = 0;
      a.play().catch(() => {
        // ignore
      });
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;

    function pushToast(detail: NotificationEvent) {
      if (!detail?.type) return;

      const dedupId =
        detail.id ||
        `${detail.type}:${detail.target_user_id || ""}:${detail.title || ""}:${detail.description || ""}`;

      if (seenIds.current.has(dedupId)) return;
      seenIds.current.add(dedupId);

      const toast: ToastNotification = {
        id: makeId(),
        source_id: detail.id,
        visible: true,
        ...detail,
      };

      setToasts((prev) => [...prev, toast]);

      // 🔔 Notificação nativa do OS (aparece perto do relógio)
      const remoteJid = detail.meta?.remote_jid || detail.meta?.remoteJid || detail.meta?.jid || "";
      const taskId = detail.meta?.task_id || detail.meta?.taskId || "";
      showNativeNotification(
        detail.title || "Delvor",
        detail.description || "",
        () => {
          if (taskId) {
            navigate(`/agenda?task=${encodeURIComponent(taskId)}`);
          } else if (remoteJid) {
            navigate(`/chat?jid=${encodeURIComponent(remoteJid)}`);
          } else if (detail.type === "chat") {
            navigate("/chat");
          }
        }
      );

      // 🔊 som (chat e tarefas)
      if (shouldPlaySound(detail)) {
        playSound();
      }

      // esconde
      setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === toast.id ? { ...t, visible: false } : t))
        );
      }, 4000);

      // remove
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 4500);
    }

    // Fallback (eventos manuais)
    function handleNotification(e: any) {
      const detail: NotificationEvent = e?.detail;
      if (!detail?.type) return;
      
      // 🛑 TRAVA DEFINITIVA PARA MENSAGENS DE CHAT
      if (detail.type === "chat") {
        // Tenta pegar o ID do usuário de três lugares possíveis
        const targetId = 
          detail.target_user_id || 
          detail.meta?.assigned_user_id || 
          detail.meta?.user_id;

        // Se encontrou um dono para esse lead, e não for o usuário logado, descarta!
        if (targetId && targetId !== userId) {
          return;
        }

        // Se NÃO encontrou de quem é (ou seja, targetId é nulo),
        // o padrão atual é mostrar a notificação (lead órfão/não atribuído).
        // Se quiser que APENAS o dono receba e ninguém veja os não-atribuídos, 
        // ative a linha abaixo:
        // if (!targetId) return;
      }
      
      pushToast(detail);
    }

    window.addEventListener("crm-notification", handleNotification);

    // ✅ Realtime via Supabase (tabela notifications)
    const channel =
      companyId && userId
        ? supabase
            .channel(`toast-notifications:${companyId}:${userId}`)
            .on(
              "postgres_changes",
              {
                event: "INSERT",
                schema: "public",
                table: "notifications",
                filter: `user_id=eq.${userId}`,
              },
              (payload: any) => {
                const row = payload?.new as any;
                if (!row) return;

                // Evita duplicidade: mensagens do WhatsApp e alertas de tarefa
                // já disparam via evento interno `crm-notification`.
                // Mantemos o realtime da tabela `notifications` para outros tipos.
                if (row.type === "chat" || row.type === "task_overdue" || row.type === "task_due_soon") {
                  return;
                }

                // segurança multi-tenant
                if (companyId && row.company_id && row.company_id !== companyId) return;

                // 🛑 CORREÇÃO: Garante que a linha do banco realmente pertence a este usuário
                if (row.user_id && row.user_id !== userId) return;

                pushToast({
                  id: row.id,
// ...
                  type: row.type,
                  title:
                    row.title ||
                    (row.type === "lead_assigned"
                      ? "Novo lead atribuído"
                      : row.type === "task_created"
                      ? "Nova tarefa"
                      : "Nova notificação"),
                  description: row.body || "",
                  target_user_id: row.user_id,
                  meta: row.meta || {},
                });
              }
            )
            .subscribe()
        : null;

    return () => {
      window.removeEventListener("crm-notification", handleNotification);
      if (channel) supabase.removeChannel(channel);
    };
  }, [companyId, userId]);

  function renderIcon(type: NotificationType) {
    if (type === "lead_assigned") return <UserPlus className="h-5 w-5 text-blue-600" />;
    if (type === "task_created") return <ClipboardList className="h-5 w-5 text-green-600" />;
    return <Bell className="h-5 w-5" />;
  }

  async function markSourceAsRead(sourceId?: string) {
    if (!sourceId || !companyId || !userId) return;
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", sourceId)
      .eq("company_id", companyId)
      .eq("user_id", userId);
  }

  function openChat(remoteJid: string) {
    if (!remoteJid) return;
    navigate(`/chat?jid=${encodeURIComponent(remoteJid)}`);
  }

  function openChatList() {
    // fallback: abre a tela de chat/lista quando não temos o jid
    navigate(`/chat`);
  }

  function openAgenda(taskId?: string) {
    if (taskId) {
      navigate(`/agenda?task=${encodeURIComponent(taskId)}`);
      return;
    }
    navigate(`/agenda`);
  }

  function openLeads(leadId?: string) {
    // fallback: abre a tela de leads. Se existir filtro por lead no projeto,
    // suportamos via querystring (não quebra caso a página ignore).
    if (leadId) {
      navigate(`/leads?lead=${encodeURIComponent(leadId)}`);
      return;
    }
    navigate(`/leads`);
  }

  async function handleToastClick(toast: ToastNotification) {
    const meta = toast.meta || {};
    const remoteJid =
      pickMetaValue(meta, ["remote_jid", "remoteJid", "jid", "remote"]) ||
      pickMetaValue(toast as any, ["remote_jid", "remoteJid", "jid"]);
    const taskId =
      pickMetaValue(meta, ["task_id", "taskId"]) ||
      pickMetaValue(toast as any, ["task_id", "taskId"]);
    const leadId =
      pickMetaValue(meta, ["lead_id", "leadId", "lead", "lead_code", "leadCode"]) ||
      pickMetaValue(toast as any, ["lead_id", "leadId", "lead", "lead_code", "leadCode"]);
    const href = pickMetaValue(meta, ["href", "url", "link"]);

    // prioriza tarefa > chat > link
    // ✅ Se for notificação de tarefa e não vier taskId, ainda assim abre a agenda.
    const typeStr = (toast.type || "").toString();
    if (taskId || typeStr === "task" || typeStr.startsWith("task_")) {
      openAgenda(taskId);
    } else if (leadId || typeStr === "lead_assigned" || typeStr.startsWith("lead")) {
      openLeads(leadId);
    } else if (remoteJid || typeStr === "chat") {
      if (remoteJid) openChat(remoteJid);
      else openChatList();
    } else if (href) {
      window.location.href = href;
    } else {
      // fallback: pelo menos leva para uma tela útil (lista de leads)
      openLeads();
    }

    // marca como lida (se vier da tabela notifications)
    await markSourceAsRead(toast.source_id);

    // fecha rápido ao clicar (sutil)
    setToasts((prev) =>
      prev.map((t) => (t.id === toast.id ? { ...t, visible: false } : t))
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 250);
  }

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-auto">
      {/* 🔇 Toggle do som */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setSoundMuted((v) => !v)}
          className="h-9 w-9 rounded-full border bg-background shadow-sm flex items-center justify-center hover:bg-muted/40 transition-colors"
          aria-label={soundMuted ? "Ativar som de notificações" : "Silenciar som de notificações"}
          title={soundMuted ? "Som desligado (clique para ativar)" : "Som ligado (clique para silenciar)"}
        >
          {soundMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      </div>
      {toasts.map((toast) => {
        // ✅ Clicável quando:
        // - tem task_id/remote_jid/href
        // - OU o tipo indica tarefa/chat (mesmo sem meta, abrimos a lista/agenda)
        const metaHit =
          !!pickMetaValue(toast.meta, [
            "task_id",
            "taskId",
            "remote_jid",
            "remoteJid",
            "jid",
            "remote",
            "href",
            "url",
            "link",
          ]) ||
          !!pickMetaValue(toast as any, [
            "task_id",
            "taskId",
            "remote_jid",
            "remoteJid",
            "jid",
            "remote",
          ]);

        const typeStr = (toast.type || "").toString();
        // ✅ Sempre clicável: quando não houver alvo específico (jid/task/lead),
        // o handler usa fallback (lista de leads).
        const clickable = true;

        return (
          <button
            key={toast.id}
            type="button"
            onClick={() => clickable && handleToastClick(toast)}
            className={`
              w-80 flex items-start gap-3 rounded-lg border bg-background p-4 shadow-lg text-left
              transition-all duration-300
              ${toast.visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4"}
              ${clickable ? "cursor-pointer hover:bg-muted/40" : "cursor-default"}
              pointer-events-auto
            `}
            aria-label={clickable ? "Abrir notificação" : "Notificação"}
          >
            {renderIcon(toast.type)}
            <div className="flex flex-col">
              <span className="text-sm font-semibold">
                {toast.title ||
                  (toast.type === "lead_assigned"
                    ? "Novo lead atribuído"
                    : "Nova notificação")}
              </span>
              {toast.description && (
                <span className="text-xs text-muted-foreground">{toast.description}</span>
              )}
              {clickable && (
                <span className="mt-1 text-[11px] text-muted-foreground">
                  Clique para abrir
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
