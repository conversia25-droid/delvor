import { useEffect, useMemo, useState } from "react";
import { Megaphone, MonitorUp, Plus, Power, Trash2, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

type Announcement = {
  id: string;
  title: string;
  message: string;
  severity: string;
  starts_at: string;
  ends_at: string | null;
  active: boolean;
  pinned: boolean;
  created_at: string;
  display_type: string | null;
  allow_hide_forever: boolean | null;
};

type Company = { id: string; name: string };

type MappingRow = {
  announcement_id: string;
  company_id: string;
};

const defaultMessage = "Ontem tivemos uma instabilidade no banco de dados que pode ter afetado algumas funcionalidades do sistema. O ambiente já foi estabilizado e seguimos monitorando para garantir a normalização completa.";

export default function MasterAnnouncements() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<Announcement[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [mappingMap, setMappingMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "Instabilidade temporária no sistema",
    message: defaultMessage,
    severity: "warning",
    starts_at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
    ends_at: "",
    pinned: true,
    display_type: "popup",
    allow_hide_forever: true,
    send_to_all: true,
  });
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [companySearch, setCompanySearch] = useState("");

  async function loadCompanies() {
    const { data, error } = await supabase.from("companies").select("id,name").order("name", { ascending: true });
    if (error) {
      toast({ title: "Erro ao carregar empresas", description: error.message, variant: "destructive" });
      return;
    }
    setCompanies((data || []) as Company[]);
  }

  async function loadItems() {
    setLoading(true);
    const { data, error } = await supabase
      .from("system_announcements" as any)
      .select("id,title,message,severity,starts_at,ends_at,active,pinned,created_at,display_type,allow_hide_forever")
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      toast({ title: "Erro ao carregar comunicados", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const rows = (data as Announcement[]) || [];
    setItems(rows);

    if (rows.length) {
      const ids = rows.map((item) => item.id);
      const { data: mappings, error: mappingsError } = await supabase
        .from("system_announcement_companies" as any)
        .select("announcement_id,company_id")
        .in("announcement_id", ids);

      if (mappingsError) {
        toast({ title: "Aviso", description: `Falha ao carregar segmentação: ${mappingsError.message}`, variant: "destructive" });
      }

      const nextMap: Record<string, string[]> = {};
      ((mappings || []) as MappingRow[]).forEach((row) => {
        nextMap[row.announcement_id] = [...(nextMap[row.announcement_id] || []), row.company_id];
      });
      setMappingMap(nextMap);
    } else {
      setMappingMap({});
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadCompanies();
    void loadItems();
    const channel = supabase
      .channel("master-announcements")
      .on("postgres_changes", { event: "*", schema: "public", table: "system_announcements" }, () => loadItems())
      .on("postgres_changes", { event: "*", schema: "public", table: "system_announcement_companies" }, () => loadItems())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const activeCount = useMemo(() => items.filter((item) => item.active).length, [items]);
  const filteredCompanies = useMemo(() => {
    const term = companySearch.trim().toLowerCase();
    if (!term) return companies;
    return companies.filter((company) => company.name.toLowerCase().includes(term));
  }, [companies, companySearch]);
  const companyNameMap = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c.name])), [companies]);

  function toggleCompany(companyId: string) {
    setSelectedCompanies((prev) => (prev.includes(companyId) ? prev.filter((id) => id !== companyId) : [...prev, companyId]));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.send_to_all && !selectedCompanies.length) {
      toast({ title: "Selecione ao menos uma empresa", description: "Desative o envio global apenas quando houver empresas marcadas.", variant: "destructive" });
      return;
    }

    setSaving(true);
    const payload = {
      title: form.title,
      message: form.message,
      severity: form.severity,
      starts_at: new Date(form.starts_at).toISOString(),
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      pinned: form.pinned,
      active: true,
      display_type: form.display_type,
      allow_hide_forever: form.allow_hide_forever,
      created_by: user?.id || null,
    };

    const { data: inserted, error } = await supabase.from("system_announcements" as any).insert(payload as any).select("id").single();

    if (!error && inserted && !form.send_to_all) {
      const rows = selectedCompanies.map((company_id) => ({ announcement_id: (inserted as any).id, company_id }));
      const { error: mappingError } = await supabase.from("system_announcement_companies" as any).insert(rows as any);
      if (mappingError) {
        setSaving(false);
        toast({ title: "Comunicado criado, mas a segmentação falhou", description: mappingError.message, variant: "destructive" });
        return;
      }
    }

    setSaving(false);

    if (error) {
      toast({ title: "Erro ao publicar", description: error.message, variant: "destructive" });
      return;
    }

    toast({
      title: "Comunicado publicado",
      description: form.send_to_all
        ? "O aviso já pode aparecer para toda a base conforme a forma de exibição escolhida."
        : `O aviso foi segmentado para ${selectedCompanies.length} empresa(s).`,
    });
    setForm((prev) => ({ ...prev, title: "", message: defaultMessage, send_to_all: true }));
    setSelectedCompanies([]);
    setCompanySearch("");
    void loadItems();
  }

  async function toggleActive(item: Announcement) {
    const { error } = await supabase
      .from("system_announcements" as any)
      .update({ active: !item.active } as any)
      .eq("id", item.id);

    if (error) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
      return;
    }
    void loadItems();
  }

  async function removeItem(id: string) {
    const { error } = await supabase.from("system_announcements" as any).delete().eq("id", id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return;
    }
    void loadItems();
  }

  function displayTypeLabel(value?: string | null) {
    switch (value) {
      case "popup":
        return "popup";
      case "both":
        return "banner + popup";
      default:
        return "banner";
    }
  }

  function scopeLabel(itemId: string) {
    const ids = mappingMap[itemId] || [];
    if (!ids.length) return "Todas as empresas";
    if (ids.length === 1) return companyNameMap[ids[0]] || "1 empresa";
    return `${ids.length} empresas`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-blue-300">Comunicados globais</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Avisos para toda a base ou por empresa</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Escolha se o comunicado será global ou segmentado para empresas específicas, com banner, popup no login ou ambos.
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">
          {activeCount} comunicado(s) ativo(s)
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4 text-blue-300" /> Novo comunicado</CardTitle>
            <CardDescription className="text-slate-400">Defina o conteúdo, a forma de exibição e quais empresas devem receber o aviso.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Título</Label>
                <Input id="title" value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">Mensagem</Label>
                <Textarea id="message" className="min-h-40" value={form.message} onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))} required />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="severity">Tipo</Label>
                  <select id="severity" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" value={form.severity} onChange={(e) => setForm((prev) => ({ ...prev, severity: e.target.value }))}>
                    <option value="info">Informativo</option>
                    <option value="warning">Alerta</option>
                    <option value="critical">Crítico</option>
                    <option value="success">Resolvido</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="starts_at">Início</Label>
                  <Input id="starts_at" type="datetime-local" value={form.starts_at} onChange={(e) => setForm((prev) => ({ ...prev, starts_at: e.target.value }))} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ends_at">Fim</Label>
                  <Input id="ends_at" type="datetime-local" value={form.ends_at} onChange={(e) => setForm((prev) => ({ ...prev, ends_at: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="display_type">Forma de exibição</Label>
                  <select id="display_type" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" value={form.display_type} onChange={(e) => setForm((prev) => ({ ...prev, display_type: e.target.value }))}>
                    <option value="banner">Apenas banner</option>
                    <option value="popup">Apenas popup</option>
                    <option value="both">Banner + popup</option>
                  </select>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Permitir “não mostrar novamente”</p>
                    <p className="text-xs text-slate-400">Se marcado, o usuário pode ocultar o popup permanentemente.</p>
                  </div>
                  <Switch checked={form.allow_hide_forever} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, allow_hide_forever: Boolean(checked) }))} />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Fixar comunicado</p>
                  <p className="text-xs text-slate-400">Comunicados fixos têm prioridade sobre os demais.</p>
                </div>
                <Switch checked={form.pinned} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, pinned: Boolean(checked) }))} />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Enviar para todas as empresas</p>
                  <p className="text-xs text-slate-400">Desative para escolher apenas algumas empresas.</p>
                </div>
                <Switch checked={form.send_to_all} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, send_to_all: Boolean(checked) }))} />
              </div>

              {!form.send_to_all ? (
                <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">Selecionar empresas</p>
                      <p className="text-xs text-slate-400">Marque quais empresas devem receber esse comunicado.</p>
                    </div>
                    <Badge variant="secondary">{selectedCompanies.length} selecionada(s)</Badge>
                  </div>
                  <Input placeholder="Buscar empresa..." value={companySearch} onChange={(e) => setCompanySearch(e.target.value)} />
                  <ScrollArea className="h-60 rounded-md border border-slate-800">
                    <div className="space-y-2 p-3">
                      {filteredCompanies.map((company) => (
                        <label key={company.id} className="flex items-center gap-3 rounded-lg border border-slate-800 px-3 py-2 text-sm">
                          <Checkbox checked={selectedCompanies.includes(company.id)} onCheckedChange={() => toggleCompany(company.id)} />
                          <span>{company.name}</span>
                        </label>
                      ))}
                      {!filteredCompanies.length ? <p className="text-sm text-slate-400">Nenhuma empresa encontrada.</p> : null}
                    </div>
                  </ScrollArea>
                </div>
              ) : null}

              <Button type="submit" disabled={saving}>
                <Megaphone className="mr-2 h-4 w-4" />
                {saving ? "Publicando..." : "Publicar comunicado"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MonitorUp className="h-4 w-4 text-blue-300" /> Últimos comunicados</CardTitle>
            <CardDescription className="text-slate-400">Ative, desative ou remova avisos já publicados. Escopo mostra se o envio foi global ou segmentado.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-white">{item.title}</h3>
                      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">{item.severity}</span>
                      {item.pinned ? <span className="rounded-full border border-blue-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-blue-200">Fixo</span> : null}
                      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">{displayTypeLabel(item.display_type)}</span>
                    </div>
                    <p className="text-sm text-slate-300 whitespace-pre-line">{item.message}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                      <span>Início: {new Date(item.starts_at).toLocaleString("pt-BR")}</span>
                      <span>Escopo: {scopeLabel(item.id)}</span>
                      {!mappingMap[item.id]?.length ? null : (
                        <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {mappingMap[item.id].slice(0, 3).map((id) => companyNameMap[id] || id).join(', ')}{mappingMap[item.id].length > 3 ? '…' : ''}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={() => toggleActive(item)} title={item.active ? "Desativar" : "Ativar"}>
                      <Power className="h-4 w-4" />
                    </Button>
                    <Button variant="destructive" size="icon" onClick={() => removeItem(item.id)} title="Excluir">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-400">
                  Status: <span className={item.active ? "text-emerald-300" : "text-slate-500"}>{item.active ? "ativo" : "inativo"}</span> • Publicado em {new Date(item.created_at).toLocaleString("pt-BR")}
                </div>
              </div>
            ))}
            {!items.length && !loading ? <p className="text-sm text-slate-400">Nenhum comunicado publicado ainda.</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
