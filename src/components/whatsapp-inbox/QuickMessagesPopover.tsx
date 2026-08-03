/**
 * QuickMessagesPopover
 *
 * Popover de mensagens prontas para o chat. Permite o usuário:
 *  - Salvar mensagens que ele usa com frequência (com título)
 *  - Marcar como compartilhada (todos da empresa veem) ou pessoal (só ele vê)
 *  - Buscar entre as mensagens salvas
 *  - Inserir uma mensagem com 1 clique no input do chat
 *  - Editar e apagar
 *
 * Props:
 *  - companyId: id da empresa atual
 *  - userId:    id do usuário logado
 *  - onSelect:  callback chamado ao escolher uma mensagem (recebe o texto)
 *  - leadName:  nome do lead atual (usado para substituir {{nome}} se houver)
 */

import { useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Zap, Plus, Pencil, Trash2, Search, Users, Lock } from "lucide-react";

type QuickMessage = {
  id: string;
  company_id: string;
  user_id: string | null;
  title: string;
  content: string;
  is_shared: boolean;
  created_at: string;
};

interface Props {
  companyId: string | null | undefined;
  userId: string | null | undefined;
  onSelect: (text: string) => void;
  leadName?: string;
}

export default function QuickMessagesPopover({ companyId, userId, onSelect, leadName }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<QuickMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Modal de criar/editar
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<QuickMessage | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftShared, setDraftShared] = useState(false);
  const [saving, setSaving] = useState(false);

  /* ────── Carrega mensagens ao abrir o popover ────── */
  useEffect(() => {
    if (!open || !companyId) return;
    loadMessages();
  }, [open, companyId]);

  async function loadMessages() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("quick_messages")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setMessages((data || []) as QuickMessage[]);
    } catch (e: any) {
      console.error("loadMessages error:", e);
      toast({ title: "Erro ao carregar mensagens", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  /* ────── Filtragem ────── */
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return messages;
    return messages.filter(
      (m) => m.title.toLowerCase().includes(term) || m.content.toLowerCase().includes(term)
    );
  }, [messages, search]);

  /* ────── Insere a mensagem (substitui {{nome}} se tiver) ────── */
  function handleInsert(msg: QuickMessage) {
    let text = msg.content;
    if (leadName) {
      const firstName = leadName.split(" ")[0] || leadName;
      text = text.replace(/\{\{nome\}\}/gi, firstName).replace(/\{\{nome_completo\}\}/gi, leadName);
    }
    onSelect(text);
    setOpen(false);
  }

  /* ────── Abrir editor (novo ou edição) ────── */
  function openEditor(msg?: QuickMessage) {
    if (msg) {
      setEditing(msg);
      setDraftTitle(msg.title);
      setDraftContent(msg.content);
      setDraftShared(msg.is_shared);
    } else {
      setEditing(null);
      setDraftTitle("");
      setDraftContent("");
      setDraftShared(false);
    }
    setEditorOpen(true);
  }

  /* ────── Salvar (insert/update) ────── */
  async function handleSave() {
    if (!draftTitle.trim() || !draftContent.trim()) {
      toast({ title: "Preencha título e conteúdo", variant: "destructive" });
      return;
    }
    if (!companyId || !userId) return;

    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase
          .from("quick_messages")
          .update({
            title: draftTitle.trim(),
            content: draftContent.trim(),
            is_shared: draftShared,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editing.id);
        if (error) throw error;
        toast({ title: "Mensagem atualizada!" });
      } else {
        const { error } = await supabase.from("quick_messages").insert({
          company_id: companyId,
          user_id: userId,
          title: draftTitle.trim(),
          content: draftContent.trim(),
          is_shared: draftShared,
        });
        if (error) throw error;
        toast({ title: "Mensagem salva!" });
      }
      setEditorOpen(false);
      await loadMessages();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  /* ────── Apagar ────── */
  async function handleDelete(msg: QuickMessage) {
    if (!confirm(`Apagar "${msg.title}"?`)) return;
    try {
      const { error } = await supabase.from("quick_messages").delete().eq("id", msg.id);
      if (error) throw error;
      toast({ title: "Mensagem removida." });
      await loadMessages();
    } catch (e: any) {
      toast({ title: "Erro ao apagar", description: e.message, variant: "destructive" });
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="outline"
            title="Mensagens prontas"
            className="shrink-0 rounded-full h-9 w-9"
          >
            <Zap className="h-4 w-4" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[360px] p-0" align="end" side="top">
          <div className="p-3 border-b flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <div className="font-semibold text-sm flex-1">Mensagens prontas</div>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEditor()}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Nova
            </Button>
          </div>

          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>

          <ScrollArea className="h-[320px]">
            {loading ? (
              <div className="p-6 text-center text-xs text-muted-foreground">Carregando...</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                {search
                  ? "Nenhuma mensagem encontrada."
                  : "Nenhuma mensagem salva. Clique em \"Nova\" pra começar."}
              </div>
            ) : (
              <div className="p-1">
                {filtered.map((m) => {
                  const isMine = m.user_id === userId;
                  return (
                    <div
                      key={m.id}
                      className="group rounded-md hover:bg-muted px-2 py-2 cursor-pointer transition"
                      onClick={() => handleInsert(m)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm flex-1 truncate" title={m.title}>
                          {m.title}
                        </span>
                        {m.is_shared ? (
                          <Users className="h-3 w-3 text-emerald-600 shrink-0" />
                        ) : (
                          <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                        {isMine && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                            <button
                              type="button"
                              className="h-6 w-6 rounded hover:bg-background grid place-items-center"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditor(m);
                              }}
                              title="Editar"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              className="h-6 w-6 rounded hover:bg-background grid place-items-center text-red-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(m);
                              }}
                              title="Apagar"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {m.content}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <div className="p-2 border-t text-[10px] text-muted-foreground">
            Dica: use <code className="bg-muted px-1 rounded">{"{{nome}}"}</code> no texto pra
            substituir pelo primeiro nome do lead automaticamente.
          </div>
        </PopoverContent>
      </Popover>

      {/* Editor (criar/editar) */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar mensagem" : "Nova mensagem pronta"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="qm-title">Título</Label>
              <Input
                id="qm-title"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Ex: Saudação inicial"
                maxLength={60}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="qm-content">Conteúdo</Label>
              <Textarea
                id="qm-content"
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                placeholder="Olá {{nome}}, tudo bem? Sou da..."
                rows={6}
                className="resize-none"
              />
              <div className="text-[11px] text-muted-foreground">
                Use <code className="bg-muted px-1 rounded">{"{{nome}}"}</code> ou{" "}
                <code className="bg-muted px-1 rounded">{"{{nome_completo}}"}</code> pra
                personalizar com o nome do lead.
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label className="text-sm cursor-pointer">Compartilhar com a equipe</Label>
                <div className="text-[11px] text-muted-foreground">
                  Todos da empresa poderão usar essa mensagem.
                </div>
              </div>
              <Switch checked={draftShared} onCheckedChange={setDraftShared} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !draftTitle.trim() || !draftContent.trim()}>
              {saving ? "Salvando..." : editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
