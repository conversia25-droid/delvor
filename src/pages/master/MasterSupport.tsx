import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Building2, MessageSquare, Send, Filter } from 'lucide-react';

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

type Company = { id: string; name: string };
type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: 'company_user' | 'super_admin';
  message: string;
  created_at: string;
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

export default function MasterSupport() {
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCompany, setFilterCompany] = useState('all');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const companyMap = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c.name])), [companies]);
  const selectedConversation = useMemo(() => conversations.find((c) => c.id === selectedId) || null, [conversations, selectedId]);

  const filteredConversations = useMemo(() => {
    return conversations.filter((conv) => {
      const statusOk = filterStatus === 'all' || conv.status === filterStatus;
      const companyOk = filterCompany === 'all' || conv.company_id === filterCompany;
      return statusOk && companyOk;
    });
  }, [conversations, filterCompany, filterStatus]);

  async function loadBase() {
    const [{ data: convs, error: convError }, { data: comps, error: compError }] = await Promise.all([
      supabase.from('support_conversations' as any).select('id,subject,status,priority,company_id,created_at,updated_at,last_message_at').order('last_message_at', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('companies').select('id,name').order('name', { ascending: true }),
    ]);

    if (convError) {
      toast({ title: 'Erro ao carregar chamados', description: convError.message, variant: 'destructive' });
      return;
    }
    if (compError) {
      toast({ title: 'Erro ao carregar empresas', description: compError.message, variant: 'destructive' });
      return;
    }

    const rows = (convs || []) as Conversation[];
    setConversations(rows);
    setCompanies((comps || []) as Company[]);
    if (!selectedId && rows.length) setSelectedId(rows[0].id);
    if (selectedId && !rows.some((row) => row.id === selectedId)) setSelectedId(rows[0]?.id || null);
  }

  async function loadMessages(conversationId: string) {
    const { data, error } = await supabase
      .from('support_messages' as any)
      .select('id,conversation_id,sender_type,message,created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      toast({ title: 'Erro ao carregar conversa', description: error.message, variant: 'destructive' });
      return;
    }

    setMessages((data || []) as MessageRow[]);
  }

  useEffect(() => {
    void loadBase();
  }, []);

  useEffect(() => {
    if (selectedId) void loadMessages(selectedId);
    else setMessages([]);
  }, [selectedId]);

  useEffect(() => {
    const channel = supabase
      .channel('master-support')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, () => { void loadBase(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages' }, (payload) => {
        const row = payload.new as any;
        if (row?.conversation_id && row.conversation_id === selectedId) void loadMessages(selectedId);
        void loadBase();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedId]);

  async function sendReply() {
    if (!selectedConversation || !reply.trim()) return;
    setSending(true);
    const now = new Date().toISOString();
    const { error } = await supabase.from('support_messages' as any).insert({
      conversation_id: selectedConversation.id,
      company_id: selectedConversation.company_id,
      sender_type: 'super_admin',
      message: reply.trim(),
    } as any);

    if (error) {
      toast({ title: 'Erro ao responder', description: error.message, variant: 'destructive' });
      setSending(false);
      return;
    }

    await supabase.from('support_conversations' as any).update({ status: 'waiting_company', last_message_at: now } as any).eq('id', selectedConversation.id);
    setReply('');
    setSending(false);
    await loadMessages(selectedConversation.id);
    await loadBase();
  }

  async function setStatus(status: string) {
    if (!selectedConversation) return;
    const { error } = await supabase.from('support_conversations' as any).update({ status } as any).eq('id', selectedConversation.id);
    if (error) {
      toast({ title: 'Erro ao atualizar status', description: error.message, variant: 'destructive' });
      return;
    }
    await loadBase();
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-blue-300">Suporte central</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Atendimento das empresas</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">Receba chamados de todas as empresas, responda no próprio painel master e acompanhe o status em tempo real.</p>
      </div>

      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Filter className="h-4 w-4 text-blue-300" /> Filtros</CardTitle>
          <CardDescription className="text-slate-400">Refine os chamados por empresa ou status.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Status</label>
            <select className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">Todos</option>
              <option value="open">Aberto</option>
              <option value="waiting_admin">Aguardando suporte</option>
              <option value="waiting_company">Aguardando empresa</option>
              <option value="resolved">Resolvido</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Empresa</label>
            <select className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" value={filterCompany} onChange={(e) => setFilterCompany(e.target.value)}>
              <option value="all">Todas</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[360px,1fr]">
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-300" /> Caixa de entrada</CardTitle>
            <CardDescription className="text-slate-400">{filteredConversations.length} chamado(s) no filtro atual.</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[560px]">
              <div className="space-y-2">
                {filteredConversations.map((conv) => (
                  <button key={conv.id} type="button" onClick={() => setSelectedId(conv.id)} className={`w-full rounded-xl border p-3 text-left transition ${selectedId === conv.id ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 hover:bg-slate-950'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{conv.subject}</p>
                        <p className="truncate text-xs text-slate-400">{companyMap[conv.company_id] || conv.company_id}</p>
                      </div>
                      <Badge variant="secondary">{priorityLabel[conv.priority] || conv.priority}</Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <Badge variant={conv.status === 'resolved' ? 'outline' : 'default'}>{statusLabel[conv.status] || conv.status}</Badge>
                      <span className="text-[11px] text-slate-400">{new Date(conv.last_message_at || conv.created_at).toLocaleString('pt-BR')}</span>
                    </div>
                  </button>
                ))}
                {!filteredConversations.length ? <p className="text-sm text-slate-400">Nenhum chamado neste filtro.</p> : null}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-blue-300" /> Conversa</CardTitle>
            <CardDescription className="text-slate-400">Responda pelo painel master e atualize o status conforme o atendimento avança.</CardDescription>
          </CardHeader>
          <CardContent>
            {selectedConversation ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{selectedConversation.subject}</h3>
                      <p className="text-sm text-slate-400">Empresa: {companyMap[selectedConversation.company_id] || selectedConversation.company_id}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{priorityLabel[selectedConversation.priority] || selectedConversation.priority}</Badge>
                      <Badge variant={selectedConversation.status === 'resolved' ? 'outline' : 'default'}>{statusLabel[selectedConversation.status] || selectedConversation.status}</Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setStatus('waiting_admin')}>Aguardando suporte</Button>
                    <Button variant="outline" size="sm" onClick={() => setStatus('waiting_company')}>Aguardando empresa</Button>
                    <Button variant="outline" size="sm" onClick={() => setStatus('resolved')}>Resolver</Button>
                  </div>
                </div>

                <ScrollArea className="h-[330px] rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                  <div className="space-y-3">
                    {messages.map((message) => (
                      <div key={message.id} className={`flex ${message.sender_type === 'super_admin' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm ${message.sender_type === 'super_admin' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-100'}`}>
                          <p className="whitespace-pre-line">{message.message}</p>
                          <p className={`mt-2 text-[11px] ${message.sender_type === 'super_admin' ? 'text-blue-100/80' : 'text-slate-400'}`}>
                            {message.sender_type === 'super_admin' ? 'Suporte master' : 'Empresa'} • {new Date(message.created_at).toLocaleString('pt-BR')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="space-y-3">
                  <Textarea className="min-h-28 border-slate-700 bg-slate-950 text-slate-100" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Digite a resposta para a empresa..." />
                  <div className="flex justify-end">
                    <Button onClick={sendReply} disabled={sending || !reply.trim()}>
                      <Send className="mr-2 h-4 w-4" />
                      {sending ? 'Enviando...' : 'Responder'}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-[480px] items-center justify-center text-sm text-slate-400">Selecione um chamado na caixa de entrada.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
