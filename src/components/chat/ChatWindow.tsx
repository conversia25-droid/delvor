import { useEffect, useMemo, useRef, useState } from "react";
import {
  Send, Loader2, Smartphone, ExternalLink, MessageSquare,
  Paperclip, Mic, X, Search, ChevronUp, ChevronDown,
  Image as ImageIcon, FileText, Info, Smile, Square,
  Image, Video, File, Music,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/use-toast";

import {
  sendWhatsApp, sendWhatsAppMedia, fileToBase64, mimeToMediaType,
} from "@/lib/whatsapp";

import MessageBubble from "./MessageBubble";
import RecordingWaveBars from "./RecordingWaveBars";
import EmojiPicker from "./EmojiPicker";
import type { ChatConversation, ChatMessage } from "./types";

interface Props {
  conversation: ChatConversation | null;
  messages: ChatMessage[];
  loading: boolean;
  companyId: string | null | undefined;
  userId: string | null | undefined;
  onSent: () => void;
  onToggleInfo: () => void;
  infoOpen: boolean;
}

const MAX_FILE_SIZE = 16 * 1024 * 1024;

const MEDIA_TYPES = [
  { key: "image",   icon: Image,    label: "Foto",       accept: "image/*",                                                       color: "text-emerald-400" },
  { key: "video",   icon: Video,    label: "Vídeo",      accept: "video/mp4,video/quicktime",                                     color: "text-sky-400" },
  { key: "audio",   icon: Music,    label: "Áudio",      accept: "audio/*",                                                       color: "text-amber-400" },
  { key: "doc",     icon: File,     label: "Documento",  accept: ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar",                color: "text-blue-400" },
] as const;

export default function ChatWindow({
  conversation, messages, loading, companyId, userId,
  onSent, onToggleInfo, infoOpen,
}: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [draggingOver, setDraggingOver] = useState(false);
  const [quotedMsg, setQuotedMsg] = useState<ChatMessage | null>(null);
  const [openEmoji, setOpenEmoji] = useState(false);
  const [openMediaMenu, setOpenMediaMenu] = useState(false);

  // Preview de mídia antes de enviar (igual CRM)
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState("");

  // Áudio
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>([]);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<BlobPart[]>([]);
  const recIntervalRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  // Busca local
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchIdx, setSearchIdx] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  /* Auto-scroll */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, conversation?.key]);

  /* Limpa estado ao trocar conv */
  useEffect(() => {
    setQuotedMsg(null);
    setSearchOpen(false);
    setSearchTerm("");
    setPendingFiles([]);
    setCaption("");
    setText("");
  }, [conversation?.key]);

  /* Index pra resolver quotes */
  const messageMap = useMemo(() => {
    const m = new Map<string, ChatMessage>();
    for (const msg of messages) if (msg.message_id) m.set(msg.message_id, msg);
    return m;
  }, [messages]);

  /* Busca */
  const searchHits = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return [];
    return messages
      .map((m, i) => ({ msg: m, i }))
      .filter(({ msg }) => (msg.message || "").toLowerCase().includes(q));
  }, [searchTerm, messages]);

  useEffect(() => {
    if (!searchHits.length) return;
    const hit = searchHits[Math.min(searchIdx, searchHits.length - 1)];
    const el = document.querySelector(`[data-message-id="${hit.msg.message_id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [searchIdx, searchHits]);

  function handleScrollToQuoted(messageId: string) {
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-blue-400");
      setTimeout(() => el.classList.remove("ring-2", "ring-blue-400"), 1500);
    }
  }

  /* ENVIO DE TEXTO */
  async function handleSendText() {
    const msg = text.trim();
    if (!msg || !companyId || !conversation) return;
    setSending(true);
    try {
      const r = await sendWhatsApp(conversation.remote_jid, msg, {
        companyId,
        userId,
        noFallback: true,
        quotedMessageId: quotedMsg?.message_id || undefined,
      });
      if (!r.ok) {
        toast({ title: "Falha no envio", description: r.error || "Tente novamente.", variant: "destructive" });
        return;
      }
      setText("");
      setQuotedMsg(null);
      onSent();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  /* ENVIO DE MÍDIA — após preview */
  async function sendPending() {
    if (!conversation || !companyId || pendingFiles.length === 0) return;
    setSending(true);
    try {
      for (const file of pendingFiles) {
        if (file.size > MAX_FILE_SIZE) {
          toast({ title: "Arquivo muito grande", description: `${file.name} > 16MB`, variant: "destructive" });
          continue;
        }
        const base64 = await fileToBase64(file);
        const type = mimeToMediaType(file.type || "");
        const r = await sendWhatsAppMedia({
          phone: conversation.remote_jid,
          type,
          data: base64,
          fileName: file.name,
          mimeType: file.type,
          caption: caption.trim() || (type === "doc" ? file.name : undefined),
          companyId,
          userId,
          quotedMessageId: quotedMsg?.message_id || undefined,
        });
        if (!r.ok) toast({ title: `Falha em ${file.name}`, description: r.error, variant: "destructive" });
      }
      setPendingFiles([]);
      setCaption("");
      setQuotedMsg(null);
      onSent();
    } finally {
      setSending(false);
    }
  }

  /* PICKING FILES */
  function pickFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    setPendingFiles((prev) => [...prev, ...arr]);
  }

  /* DRAG-DROP */
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setDraggingOver(true); }
  function handleDragLeave() { setDraggingOver(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDraggingOver(false);
    if (e.dataTransfer.files?.length) pickFiles(e.dataTransfer.files);
  }

  /* GRAVAÇÃO COM WAVEFORM */
  async function startRecording() {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recChunksRef.current = [];
      mr.ondataavailable = (ev) => { if (ev.data.size > 0) recChunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (audioCtxRef.current) {
          audioCtxRef.current.close().catch(() => {});
          audioCtxRef.current = null;
        }
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        const blob = new Blob(recChunksRef.current, { type: "audio/webm" });
        if (blob.size < 200) {
          toast({ title: "Áudio muito curto", variant: "destructive" });
          return;
        }
        const file = new File([blob], `audio-${Date.now()}.webm`, { type: "audio/webm" });
        // Envia direto (sem preview)
        setPendingFiles([file]);
        setTimeout(() => sendPendingDirect([file]), 50);
      };
      mr.start();
      mediaRecRef.current = mr;
      setRecording(true);
      setRecordSeconds(0);
      recIntervalRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);

      // Waveform: AnalyserNode lê os níveis
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);
      analyserRef.current = analyser;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(dataArray);
        const levels: number[] = [];
        const step = Math.floor(dataArray.length / 16);
        for (let i = 0; i < 16; i++) {
          levels.push((dataArray[i * step] || 0) / 255);
        }
        setAudioLevels(levels);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e: any) {
      toast({
        title: "Sem permissão de microfone",
        description: e?.message || "Verifique as permissões do navegador.",
        variant: "destructive",
      });
    }
  }

  /** Manda mídia direto sem caption (usado pelo áudio gravado) */
  async function sendPendingDirect(files: File[]) {
    if (!conversation || !companyId) return;
    setSending(true);
    try {
      for (const file of files) {
        const base64 = await fileToBase64(file);
        const type = mimeToMediaType(file.type || "");
        await sendWhatsAppMedia({
          phone: conversation.remote_jid,
          type,
          data: base64,
          fileName: file.name,
          mimeType: file.type,
          companyId,
          userId,
        });
      }
      setPendingFiles([]);
      onSent();
    } finally {
      setSending(false);
    }
  }

  function stopRecording(send: boolean) {
    const mr = mediaRecRef.current;
    if (!mr) return;
    if (!send) {
      mr.ondataavailable = null;
      mr.onstop = () => {
        mr.stream.getTracks().forEach((t) => t.stop());
        if (audioCtxRef.current) {
          audioCtxRef.current.close().catch(() => {});
          audioCtxRef.current = null;
        }
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      };
    }
    mr.stop();
    mediaRecRef.current = null;
    setRecording(false);
    if (recIntervalRef.current) {
      window.clearInterval(recIntervalRef.current);
      recIntervalRef.current = null;
    }
  }

  /* PASTE imagem do clipboard */
  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData.items;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      pickFiles(files);
    }
  }

  /* INSERIR EMOJI */
  function insertEmoji(emoji: string) {
    const el = inputRef.current;
    if (!el) {
      setText((p) => p + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (pendingFiles.length > 0) sendPending();
      else handleSendText();
    }
  }

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
        <MessageSquare className="h-12 w-12 mb-4 opacity-30" />
        <p className="font-medium">Selecione uma conversa</p>
        <p className="text-xs mt-1 max-w-sm">
          Mensagens enviadas pelo sistema e recebidas dos seus contatos aparecem aqui.
        </p>
      </div>
    );
  }

  const headerName = conversation.display_name || `+${conversation.remote_jid}`;
  const totalHits = searchHits.length;
  const activeHitId = searchHits[searchIdx]?.msg.message_id;

  return (
    <div
      className="flex-1 flex flex-col bg-slate-950/50 relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* OVERLAY DRAG-DROP */}
      {draggingOver && (
        <div className="absolute inset-0 z-50 bg-blue-600/20 border-4 border-blue-500 border-dashed flex flex-col items-center justify-center pointer-events-none">
          <ImageIcon className="h-12 w-12 text-blue-300 mb-2" />
          <p className="text-blue-200 font-medium text-lg">Solte aqui pra enviar</p>
        </div>
      )}

      {/* HEADER */}
      <div className="border-b border-border/50 px-4 py-3 flex items-center justify-between gap-3 bg-card/40 sticky top-0 z-10 backdrop-blur-sm">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarFallback className={conversation.customer_id
              ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
              : "bg-white/10 text-muted-foreground ring-1 ring-white/10"}>
              {(conversation.display_name?.slice(0, 2) || conversation.remote_jid?.slice(-2) || "??").toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold truncate">{headerName}</span>
              {conversation.customer_id && (
                <Badge variant="outline" className="text-[10px] h-4">Cliente</Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              +{conversation.remote_jid}
              {conversation.instance_label && (
                <span className="ml-2 inline-flex items-center gap-0.5">
                  <Smartphone className="h-2.5 w-2.5" />
                  {conversation.instance_label}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setSearchOpen((v) => !v)} title="Buscar">
            <Search className="h-4 w-4" />
          </Button>
          <Button size="icon" variant={infoOpen ? "secondary" : "ghost"} onClick={onToggleInfo} title="Informações do contato">
            <Info className="h-4 w-4" />
          </Button>
          {conversation.customer_id && (
            <Button asChild size="sm" variant="ghost">
              <Link to={`/customers/${conversation.customer_id}`}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Cliente
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* BUSCA */}
      {searchOpen && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-card/30">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Buscar nesta conversa..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setSearchIdx(0); }}
            className="h-7 text-sm"
          />
          <span className="text-xs text-muted-foreground shrink-0">
            {totalHits ? `${searchIdx + 1}/${totalHits}` : (searchTerm ? "0" : "")}
          </span>
          <Button size="icon" variant="ghost" className="h-6 w-6" disabled={!totalHits}
            onClick={() => setSearchIdx((i) => (i - 1 + totalHits) % totalHits)}>
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" disabled={!totalHits}
            onClick={() => setSearchIdx((i) => (i + 1) % totalHits)}>
            <ChevronDown className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6"
            onClick={() => { setSearchOpen(false); setSearchTerm(""); }}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* MENSAGENS */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {loading && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
            Carregando mensagens...
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Sem mensagens nesta conversa.
          </div>
        )}
        {!loading && messages.map((m) => {
          const quoted = m.context_quoted_message_id ? messageMap.get(m.context_quoted_message_id) : null;
          const isHit = activeHitId && m.message_id === activeHitId;
          return (
            <MessageBubble
              key={m.id}
              message={m}
              quotedMessage={quoted}
              onReply={(msg) => setQuotedMsg(msg)}
              onScrollToQuoted={handleScrollToQuoted}
              highlight={!!isHit}
            />
          );
        })}
      </div>

      {/* PREVIEW DE MÍDIA ANTES DE ENVIAR */}
      {pendingFiles.length > 0 && (
        <div className="border-t border-border/50 bg-card/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              📎 {pendingFiles.length} arquivo{pendingFiles.length === 1 ? "" : "s"} pendente{pendingFiles.length === 1 ? "" : "s"}
            </span>
            <Button size="sm" variant="ghost" onClick={() => { setPendingFiles([]); setCaption(""); }}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancelar
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((file, idx) => {
              const url = URL.createObjectURL(file);
              const type = mimeToMediaType(file.type || "");
              return (
                <div key={idx} className="relative h-20 w-20 rounded-lg border bg-muted/30 overflow-hidden flex items-center justify-center">
                  {type === "image" && <img src={url} alt={file.name} className="h-full w-full object-cover" />}
                  {type === "video" && <video src={url} className="h-full w-full object-cover" />}
                  {type === "audio" && (
                    <div className="flex flex-col items-center justify-center">
                      <Music className="h-6 w-6 text-amber-400" />
                      <span className="text-[9px] mt-1 px-1 truncate w-16 text-center">{file.name}</span>
                    </div>
                  )}
                  {type === "doc" && (
                    <div className="flex flex-col items-center justify-center">
                      <FileText className="h-6 w-6 text-blue-400" />
                      <span className="text-[9px] mt-1 px-1 truncate w-16 text-center">{file.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-rose-600 text-white text-[10px] flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          {!pendingFiles.every((f) => f.type.startsWith("audio/")) && (
            <Input
              placeholder="Escreva uma legenda (opcional)..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="h-9 text-sm"
              autoFocus
            />
          )}
          <div className="flex justify-end">
            <Button onClick={sendPending} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              Enviar
            </Button>
          </div>
        </div>
      )}

      {/* BARRA DE QUOTE */}
      {quotedMsg && pendingFiles.length === 0 && (
        <div className="border-t border-border/50 px-3 py-2 bg-blue-500/10 flex items-center gap-2">
          <svg className="h-4 w-4 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 10 20 15 15 20" />
            <path d="M4 4v7a4 4 0 0 0 4 4h12" />
          </svg>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-blue-300 font-semibold">
              Respondendo {quotedMsg.from_me ? "você mesmo" : "ao cliente"}
            </div>
            <div className="text-xs truncate opacity-80">
              {quotedMsg.message || quotedMessageTypeLabel(quotedMsg.message_type)}
            </div>
          </div>
          <button type="button" onClick={() => setQuotedMsg(null)} className="opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* RECORDING BAR */}
      {recording && (
        <div className="border-t border-border/50 px-4 py-3 bg-rose-500/10 flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
          <RecordingWaveBars levels={audioLevels} />
          <span className="text-sm font-semibold text-rose-300 tabular-nums">{formatRecordTime(recordSeconds)}</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => stopRecording(false)}>
            <X className="h-4 w-4 mr-1" /> Cancelar
          </Button>
          <Button size="sm" onClick={() => stopRecording(true)}>
            <Square className="h-4 w-4 mr-1" /> Parar e enviar
          </Button>
        </div>
      )}

      {/* INPUT */}
      {!recording && pendingFiles.length === 0 && (
        <div className="border-t border-border/50 p-3 bg-card/40">
          <div className="flex items-end gap-2">
            {/* Botão grava áudio */}
            <Button
              size="icon"
              variant="outline"
              onClick={startRecording}
              disabled={sending}
              title="Gravar áudio"
              className="h-11 w-11 rounded-full shrink-0"
            >
              <Mic className="h-4 w-4" />
            </Button>

            {/* Caixa flex unificada do input */}
            <div className="flex-1 flex items-end gap-1 rounded-2xl border bg-muted/40 px-2 py-1">
              {/* Menu mídia */}
              <Popover open={openMediaMenu} onOpenChange={setOpenMediaMenu}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9" title="Anexar">
                    <Paperclip className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-48 p-1">
                  {MEDIA_TYPES.map((t) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted rounded transition text-left"
                        onClick={() => {
                          const inp = fileRefs.current[t.key];
                          if (inp) inp.click();
                          setOpenMediaMenu(false);
                        }}
                      >
                        <Icon className={`h-4 w-4 ${t.color}`} />
                        {t.label}
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>

              {/* File inputs por tipo */}
              {MEDIA_TYPES.map((t) => (
                <input
                  key={t.key}
                  ref={(el) => { fileRefs.current[t.key] = el; }}
                  type="file"
                  hidden
                  multiple
                  accept={t.accept}
                  onChange={(e) => { if (e.target.files?.length) pickFiles(e.target.files); e.currentTarget.value = ""; }}
                />
              ))}

              {/* Emoji */}
              <Popover open={openEmoji} onOpenChange={setOpenEmoji}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9" title="Emojis">
                    <Smile className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="p-0">
                  <EmojiPicker onSelect={(e) => { insertEmoji(e); setOpenEmoji(false); }} />
                </PopoverContent>
              </Popover>

              {/* Textarea */}
              <Textarea
                ref={inputRef}
                placeholder="Digite uma mensagem..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                rows={1}
                disabled={sending}
                className="resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 min-h-[44px] max-h-[120px] py-2.5 text-sm"
              />
            </div>

            {/* Botão enviar */}
            <Button
              type="button"
              size="icon"
              onClick={handleSendText}
              disabled={sending || !text.trim()}
              className="h-11 w-11 rounded-full shrink-0"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <div className="text-[10px] text-muted-foreground mt-1 px-1">
            Enviando via instância <strong>{conversation.instance_label || conversation.instance_id}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

function quotedMessageTypeLabel(type: string | null): string {
  if (!type) return "Mensagem";
  const map: Record<string, string> = {
    imageMessage: "📷 Imagem",
    audioMessage: "🎵 Áudio",
    videoMessage: "🎥 Vídeo",
    documentMessage: "📄 Documento",
    stickerMessage: "🪄 Figurinha",
    locationMessage: "📍 Localização",
  };
  return map[type] || "Mensagem";
}

function formatRecordTime(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
