import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { MessageSquare, Send, LifeBuoy, Plus, ChevronLeft, FolderOpen, Image as ImageIcon, Paperclip, X } from 'lucide-react';

type Conversation = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  company_id: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: 'company_user' | 'super_admin';
  message: string;
  created_at: string;
  sender_user_id?: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  attachment_size?: number | null;
};

const statusLabel: Record<string, string> = {
  open: 'Aberto',
  waiting_admin: 'Aguardando suporte',
  waiting_company: 'Aguardando empresa',
  resolved: 'Resolvido',
};

const priorityLabel: Record<string, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

type EmbeddedSection = 'menu' | 'new' | 'tickets' | 'conversation';
const STORAGE_BUCKET = 'support_uploads';
const MAX_IMAGE_MB = 8;

function isImageType(type?: string | null) {
  return !!type && type.startsWith('image/');
}

function formatFileSize(size?: number | null) {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function MessageAttachment({ message }: { message: MessageRow }) {
  if (!message.attachment_url) return null;

  if (isImageType(message.attachment_type)) {
    return (
      <a href={message.attachment_url} target="_blank" rel="noreferrer" className="mt-3 block overflow-hidden rounded-2xl border border-white/10 bg-black/10">
        <img
          src={message.attachment_url}
          alt={message.attachment_name || 'Imagem enviada no suporte'}
          className="max-h-72 w-full object-cover"
          loading="lazy"
        />
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-[11px] opacity-90">
          <span className="truncate">{message.attachment_name || 'Imagem'}</span>
          <span className="shrink-0">{formatFileSize(message.attachment_size)}</span>
        </div>
      </a>
    );
  }

  return (
    <a
      href={message.attachment_url}
      target="_blank"
      rel="noreferrer"
      className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-sm transition hover:opacity-90"
    >
      <Paperclip className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{message.attachment_name || 'Arquivo anexo'}</p>
        <p className="text-[11px] opacity-80">{formatFileSize(message.attachment_size) || message.attachment_type || 'Arquivo'}</p>
      </div>
    </a>
  );
}

export function SupportPanel({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const companyId = user?.company_id || null;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState('');
  const [priority, setPriority] = useState('normal');
  const [openingMessage, setOpeningMessage] = useState('');
  const [reply, setReply] = useState('');
  const [embeddedSection, setEmbeddedSection] = useState<EmbeddedSection>(embedded ? 'menu' : 'tickets');
  const [openingImage, setOpeningImage] = useState<File | null>(null);
  const [openingPreview, setOpeningPreview] = useState<string | null>(null);
  const [replyImage, setReplyImage] = useState<File | null>(null);
  const [replyPreview, setReplyPreview] = useState<string | null>(null);

  const openingInputRef = useRef<HTMLInputElement | null>(null);
  const replyInputRef = useRef<HTMLInputElement | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedId) || null,
    [conversations, selectedId]
  );

  function cleanupPreview(url: string | null) {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  }

  function applyImageSelection(
    file: File | null,
    setter: (file: File | null) => void,
    preview: string | null,
    setPreview: (value: string | null) => void,
  ) {
    cleanupPreview(preview);
    setter(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  function validateImage(file: File | null) {
    if (!file) return true;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Arquivo inválido', description: 'Selecione apenas imagens.', variant: 'destructive' });
      return false;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      toast({ title: 'Imagem muito grande', description: `Use arquivos de até ${MAX_IMAGE_MB} MB.`, variant: 'destructive' });
      return false;
    }
    return true;
  }

  async function uploadImage(file: File) {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${companyId}/${user?.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

    return {
      attachment_url: data.publicUrl,
      attachment_name: file.name,
      attachment_type: file.type,
      attachment_size: file.size,
    };
  }

  async function loadConversations() {
    if (!companyId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('support_conversations' as any)
      .select('id,subject,status,priority,company_id,created_at,updated_at,last_message_at')
      .eq('company_id', companyId)
      .order('last_message_at', { ascending: false })
      .order('created_at', { ascending: false });

    setLoading(false);

    if (error) {
      toast({ title: 'Erro ao carregar suporte', description: error.message, variant: 'destructive' });
      return;
    }

    const rows = (data || []) as Conversation[];
    setConversations(rows);
    if (!selectedId && rows.length) setSelectedId(rows[0].id);
    if (selectedId && !rows.some((row) => row.id === selectedId)) setSelectedId(rows[0]?.id || null);
  }

  async function loadMessages(conversationId: string) {
    const { data, error } = await supabase
      .from('support_messages' as any)
      .select('id,conversation_id,sender_type,message,created_at,sender_user_id,attachment_url,attachment_name,attachment_type,attachment_size')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      toast({ title: 'Erro ao carregar mensagens', description: error.message, variant: 'destructive' });
      return;
    }

    setMessages((data || []) as MessageRow[]);
  }

  useEffect(() => {
    void loadConversations();
  }, [companyId]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!companyId) return;

    const channel = supabase
      .channel(`support-company-${companyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_conversations', filter: `company_id=eq.${companyId}` },
        () => {
          void loadConversations();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_messages', filter: `company_id=eq.${companyId}` },
        (payload) => {
          const row = payload.new as any;
          if (row?.conversation_id && row.conversation_id === selectedId) {
            void loadMessages(selectedId);
          }
          void loadConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, selectedId]);

  useEffect(() => {
    return () => {
      cleanupPreview(openingPreview);
      cleanupPreview(replyPreview);
    };
  }, [openingPreview, replyPreview]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!companyId || !user?.id) return;
    if (!openingMessage.trim() && !openingImage) {
      toast({ title: 'Informe a solicitação', description: 'Digite uma mensagem ou anexe uma imagem.', variant: 'destructive' });
      return;
    }

    setCreating(true);

    const { data: created, error } = await supabase
      .from('support_conversations' as any)
      .insert({
        company_id: companyId,
        created_by: user.id,
        subject,
        priority,
        status: 'open',
        last_message_at: new Date().toISOString(),
      } as any)
      .select('id,subject,status,priority,company_id,created_at,updated_at,last_message_at')
      .single();

    if (error || !created) {
      setCreating(false);
      toast({ title: 'Erro ao abrir chamado', description: error?.message || 'Falha ao criar chamado.', variant: 'destructive' });
      return;
    }

    try {
      const attachment = openingImage ? await uploadImage(openingImage) : {};

      const { error: msgError } = await supabase.from('support_messages' as any).insert({
        conversation_id: (created as any).id,
        company_id: companyId,
        sender_user_id: user.id,
        sender_type: 'company_user',
        message: openingMessage.trim(),
        ...attachment,
      } as any);

      if (msgError) throw msgError;

      toast({ title: 'Chamado aberto', description: 'O suporte já pode visualizar sua solicitação.' });

      setSubject('');
      setOpeningMessage('');
      setPriority('normal');
      applyImageSelection(null, setOpeningImage, openingPreview, setOpeningPreview);
      if (openingInputRef.current) openingInputRef.current.value = '';
      await loadConversations();
      setSelectedId((created as any).id);
      await loadMessages((created as any).id);
      if (embedded) setEmbeddedSection('conversation');
    } catch (err: any) {
      toast({ title: 'Chamado criado com aviso', description: err?.message || 'A mensagem inicial falhou.', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  }

  async function handleSendReply() {
    if (!selectedId || !companyId || !user?.id || (!reply.trim() && !replyImage)) return;
    setSending(true);
    const now = new Date().toISOString();

    try {
      const attachment = replyImage ? await uploadImage(replyImage) : {};
      const { error } = await supabase.from('support_messages' as any).insert({
        conversation_id: selectedId,
        company_id: companyId,
        sender_user_id: user.id,
        sender_type: 'company_user',
        message: reply.trim(),
        ...attachment,
      } as any);

      if (error) throw error;

      await supabase.from('support_conversations' as any).update({ status: 'waiting_admin', last_message_at: now } as any).eq('id', selectedId);
      setReply('');
      applyImageSelection(null, setReplyImage, replyPreview, setReplyPreview);
      if (replyInputRef.current) replyInputRef.current.value = '';
      await loadMessages(selectedId);
      await loadConversations();
    } catch (error: any) {
      toast({ title: 'Erro ao enviar mensagem', description: error.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  }

  async function markResolved() {
    if (!selectedId) return;
    const { error } = await supabase.from('support_conversations' as any).update({ status: 'resolved' } as any).eq('id', selectedId);
    if (error) {
      toast({ title: 'Erro ao encerrar chamado', description: error.message, variant: 'destructive' });
      return;
    }
    await loadConversations();
  }

  function openConversation(conversationId: string) {
    setSelectedId(conversationId);
    if (embedded) setEmbeddedSection('conversation');
  }

  function onOpeningImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    if (!validateImage(file)) {
      e.target.value = '';
      return;
    }
    applyImageSelection(file, setOpeningImage, openingPreview, setOpeningPreview);
  }

  function onReplyImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    if (!validateImage(file)) {
      e.target.value = '';
      return;
    }
    applyImageSelection(file, setReplyImage, replyPreview, setReplyPreview);
  }

  const imagePicker = (
    fileRef: React.RefObject<HTMLInputElement | null>,
    preview: string | null,
    file: File | null,
    clear: () => void,
    onChange: (e: ChangeEvent<HTMLInputElement>) => void,
  ) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onChange} />
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <ImageIcon className="mr-2 h-4 w-4" />
          Enviar imagem
        </Button>
        {file ? (
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            <X className="mr-2 h-4 w-4" />
            Remover
          </Button>
        ) : null}
      </div>

      {preview ? (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/60">
          <img src={preview} alt="Prévia da imagem" className="max-h-52 w-full object-cover" />
          <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
            <span className="truncate">{file?.name}</span>
            <span className="shrink-0">{formatFileSize(file?.size)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );

  const createForm = embedded ? (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Abrir chamado</h3>
          <p className="text-xs text-muted-foreground">Descreva o problema com contexto suficiente para o suporte agir rápido.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setEmbeddedSection('menu')}>
          <ChevronLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      </div>

      <form onSubmit={handleCreate} className="mt-4 flex min-h-0 flex-1 flex-col rounded-2xl border border-border/70 bg-background/60">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Assunto</label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex.: erro ao salvar arquivos" required />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Prioridade</label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="low">Baixa</option>
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
            <option value="urgent">Urgente</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Mensagem inicial</label>
          <Textarea
            value={openingMessage}
            onChange={(e) => setOpeningMessage(e.target.value)}
            className="min-h-32"
            placeholder="Explique o que aconteceu, quando começou e se afeta outros usuários da empresa."
          />
        </div>

        {imagePicker(openingInputRef, openingPreview, openingImage, () => {
          applyImageSelection(null, setOpeningImage, openingPreview, setOpeningPreview);
          if (openingInputRef.current) openingInputRef.current.value = '';
        }, onOpeningImageChange)}

        </div>

        <div className="border-t border-border/70 p-4">
          <div className="flex justify-end">
            <Button type="submit" disabled={creating || !companyId || (!openingMessage.trim() && !openingImage)}>
              <LifeBuoy className="mr-2 h-4 w-4" />
              {creating ? 'Abrindo...' : 'Abrir chamado'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  ) : (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4" /> Abrir chamado</CardTitle>
        <CardDescription>Descreva o problema com contexto suficiente para o suporte agir rápido.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Assunto</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex.: Instabilidade no WhatsApp / erro ao enviar mídia" required />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Prioridade</label>
            <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Baixa</option>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Mensagem inicial</label>
            <Textarea value={openingMessage} onChange={(e) => setOpeningMessage(e.target.value)} className="min-h-32" placeholder="Explique o que aconteceu, quando começou e se afeta todos os usuários da empresa." />
          </div>
          {imagePicker(openingInputRef, openingPreview, openingImage, () => {
            applyImageSelection(null, setOpeningImage, openingPreview, setOpeningPreview);
            if (openingInputRef.current) openingInputRef.current.value = '';
          }, onOpeningImageChange)}
          <div className="flex justify-end">
            <Button type="submit" disabled={creating || !companyId || (!openingMessage.trim() && !openingImage)}>
              <LifeBuoy className="mr-2 h-4 w-4" />
              {creating ? 'Abrindo chamado...' : 'Abrir chamado'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );

  const conversationList = (
    <div className="space-y-3 pr-2">
      {conversations.map((conv) => (
        <button
          key={conv.id}
          type="button"
          onClick={() => openConversation(conv.id)}
          className={`w-full rounded-2xl border p-3 text-left transition ${selectedId === conv.id ? 'border-primary bg-primary/5' : 'border-border/70 bg-background/60 hover:border-primary/40 hover:bg-primary/5'}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold text-foreground">{conv.subject}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(conv.last_message_at || conv.created_at).toLocaleString('pt-BR')}
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0">{priorityLabel[conv.priority] || conv.priority}</Badge>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <Badge variant={conv.status === 'resolved' ? 'outline' : 'default'}>
              {statusLabel[conv.status] || conv.status}
            </Badge>
          </div>
        </button>
      ))}

      {!loading && !conversations.length ? (
        <div className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum chamado ainda.
        </div>
      ) : null}
    </div>
  );

  const messageThread = (
    <div className="space-y-3 pr-2">
      {messages.map((message) => (
        <div key={message.id} className={`flex ${message.sender_type === 'company_user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm ${message.sender_type === 'company_user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>
            {message.message ? <p className="whitespace-pre-line break-words">{message.message}</p> : null}
            <MessageAttachment message={message} />
            <p className={`mt-2 text-[11px] ${message.sender_type === 'company_user' ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
              {message.sender_type === 'company_user' ? 'Você' : 'Suporte'} • {new Date(message.created_at).toLocaleString('pt-BR')}
            </p>
          </div>
        </div>
      ))}
    </div>
  );

  const embeddedTicketsPanel = (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Chamados da sua empresa</h3>
          <p className="text-xs text-muted-foreground">{loading ? 'Carregando...' : `${conversations.length} chamado(s) encontrado(s)`}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setEmbeddedSection('menu')}>
          <ChevronLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      </div>

      <ScrollArea className="h-[420px] rounded-2xl border border-border/70 bg-background/40 p-3">
        {conversationList}
      </ScrollArea>
    </div>
  );

  const embeddedConversationPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border/70 pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEmbeddedSection('tickets')}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Voltar
            </Button>
            {selectedConversation ? <Badge variant="secondary">{priorityLabel[selectedConversation.priority] || selectedConversation.priority}</Badge> : null}
          </div>
          <h3 className="mt-3 line-clamp-2 text-base font-semibold text-foreground">{selectedConversation?.subject || 'Chamado'}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Status: {selectedConversation ? statusLabel[selectedConversation.status] || selectedConversation.status : '-'}
          </p>
        </div>
        {selectedConversation && selectedConversation.status !== 'resolved' ? (
          <Button variant="outline" size="sm" onClick={markResolved}>
            Marcar resolvido
          </Button>
        ) : null}
      </div>

      <ScrollArea className="mt-4 h-[260px] rounded-2xl border border-border/70 bg-background/40 p-3">
        {messageThread}
      </ScrollArea>

      <div className="mt-4 space-y-3 rounded-2xl border border-border/70 bg-background/40 p-3">
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Escreva uma atualização para o suporte..."
          className="min-h-24"
        />
        {imagePicker(replyInputRef, replyPreview, replyImage, () => {
          applyImageSelection(null, setReplyImage, replyPreview, setReplyPreview);
          if (replyInputRef.current) replyInputRef.current.value = '';
        }, onReplyImageChange)}
        <div className="flex justify-end">
          <Button onClick={handleSendReply} disabled={sending || (!reply.trim() && !replyImage) || selectedConversation?.status === 'resolved'}>
            <Send className="mr-2 h-4 w-4" />
            {sending ? 'Enviando...' : 'Enviar mensagem'}
          </Button>
        </div>
      </div>
    </div>
  );

  const fullTicketsPanel = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Chamados da sua empresa</CardTitle>
        <CardDescription>{loading ? 'Carregando...' : `${conversations.length} chamado(s) encontrado(s)`}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[280px,1fr]">
        <div className="space-y-3">
          <ScrollArea className="h-[520px] rounded-md border">
            <div className="space-y-2 p-3">{conversationList}</div>
          </ScrollArea>
        </div>

        <div className="flex min-h-[520px] flex-col rounded-md border">
          {selectedConversation ? (
            <>
              <div className="border-b p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{selectedConversation.subject}</h3>
                    <p className="text-sm text-muted-foreground">Status: {statusLabel[selectedConversation.status] || selectedConversation.status}</p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="secondary">{priorityLabel[selectedConversation.priority] || selectedConversation.priority}</Badge>
                    {selectedConversation.status !== 'resolved' ? <Button variant="outline" size="sm" onClick={markResolved}>Marcar como resolvido</Button> : null}
                  </div>
                </div>
              </div>
              <ScrollArea className="h-[340px] p-4">
                {messageThread}
              </ScrollArea>
              <div className="mt-auto border-t p-4">
                <div className="space-y-3">
                  <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Escreva uma atualização para o suporte..." className="min-h-28" />
                  {imagePicker(replyInputRef, replyPreview, replyImage, () => {
                    applyImageSelection(null, setReplyImage, replyPreview, setReplyPreview);
                    if (replyInputRef.current) replyInputRef.current.value = '';
                  }, onReplyImageChange)}
                  <div className="flex justify-end">
                    <Button onClick={handleSendReply} disabled={sending || (!reply.trim() && !replyImage) || selectedConversation.status === 'resolved'}>
                      <Send className="mr-2 h-4 w-4" />
                      {sending ? 'Enviando...' : 'Enviar mensagem'}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">Selecione um chamado para acompanhar a conversa.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className={embedded ? 'h-full min-h-0 overflow-y-auto overflow-x-hidden' : 'space-y-6'}>
      {!embedded ? (
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-primary/80">Suporte</p>
          <h1 className="mt-2 text-3xl font-semibold">Central de suporte</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Abra chamados para sua empresa, envie imagens e acompanhe as respostas do painel master em tempo real.
          </p>
        </div>
      ) : null}

      {embedded ? (
        <div className="h-full min-h-0 overflow-hidden">
          {embeddedSection === 'menu' ? (
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => setEmbeddedSection('new')}
                className="flex w-full items-center justify-between rounded-2xl border border-border/70 bg-background px-4 py-4 text-left transition hover:border-primary/40 hover:bg-primary/5"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Plus className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">+ Abrir chamado</p>
                    <p className="text-xs text-muted-foreground">Registrar um novo atendimento com o suporte</p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setEmbeddedSection('tickets')}
                className="flex w-full items-center justify-between rounded-2xl border border-border/70 bg-background px-4 py-4 text-left transition hover:border-primary/40 hover:bg-primary/5"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FolderOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Chamados da sua empresa</p>
                    <p className="text-xs text-muted-foreground">{loading ? 'Carregando chamados...' : `${conversations.length} chamado(s) disponível(is)`}</p>
                  </div>
                </div>
              </button>
            </div>
          ) : embeddedSection === 'new' ? (
            createForm
          ) : embeddedSection === 'tickets' ? (
            embeddedTicketsPanel
          ) : (
            embeddedConversationPanel
          )}
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
          {createForm}
          {fullTicketsPanel}
        </div>
      )}
    </div>
  );
}

export default function Support() {
  return <SupportPanel />;
}
