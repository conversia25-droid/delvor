import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Copy, Plus, Trash2, Users, Link2, Eye } from "lucide-react";

type AffiliateCode = {
  id: string;
  code: string;
  owner_name: string;
  owner_email: string | null;
  max_uses: number;
  current_uses: number;
  discount_percent: number;
  active: boolean;
  created_at: string;
};

type Referral = {
  id: string;
  code: string;
  referred_email: string | null;
  created_at: string;
};

export default function MasterAffiliates() {
  const { toast } = useToast();
  const [codes, setCodes] = useState<AffiliateCode[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  // Form state
  const [newCode, setNewCode] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [maxUses, setMaxUses] = useState(20);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadCodes();
  }, []);

  async function loadCodes() {
    const { data } = await supabase
      .from("affiliate_codes")
      .select("*")
      .order("created_at", { ascending: false });

    if (data) setCodes(data as AffiliateCode[]);
    setLoading(false);
  }

  async function loadReferrals(code: string) {
    setSelectedCode(code);
    const { data } = await supabase
      .from("affiliate_referrals")
      .select("*")
      .eq("code", code)
      .order("created_at", { ascending: false });

    if (data) setReferrals(data as Referral[]);
  }

  async function createCode() {
    if (!newCode.trim() || !ownerName.trim()) {
      toast({ title: "Preencha o código e o nome do afiliado", variant: "destructive" });
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("affiliate_codes").insert({
      code: newCode.trim().toUpperCase(),
      owner_name: ownerName.trim(),
      owner_email: ownerEmail.trim() || null,
      max_uses: maxUses,
    } as any);

    if (error) {
      toast({ title: "Erro ao criar código", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Código criado com sucesso!" });
      setShowForm(false);
      setNewCode("");
      setOwnerName("");
      setOwnerEmail("");
      setMaxUses(20);
      loadCodes();
    }
    setSaving(false);
  }

  async function toggleActive(id: string, active: boolean) {
    await supabase.from("affiliate_codes").update({ active: !active } as any).eq("id", id);
    loadCodes();
  }

  async function deleteCode(id: string) {
    if (!confirm("Tem certeza que deseja excluir este código?")) return;
    await supabase.from("affiliate_referrals").delete().eq("affiliate_code_id", id);
    await supabase.from("affiliate_codes").delete().eq("id", id);
    toast({ title: "Código excluído" });
    loadCodes();
    if (selectedCode) setSelectedCode(null);
  }

  function copyLink(code: string) {
    const link = `https://infnityleads.com.br/?ref=${code}`;
    navigator.clipboard.writeText(link);
    toast({ title: "Link copiado!", description: link });
  }

  function generateCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 8; i++) result += chars[Math.floor(Math.random() * chars.length)];
    setNewCode(result);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Afiliados</h1>
          <p className="text-muted-foreground">Gerencie códigos de indicação e acompanhe os cadastros.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          <Plus className="h-4 w-4" />
          Novo código
        </Button>
      </div>

      {/* Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Criar código de afiliado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Código</label>
                <div className="flex gap-2">
                  <Input
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                    placeholder="EX: PARTNER01"
                    className="uppercase"
                  />
                  <Button variant="outline" size="sm" onClick={generateCode}>
                    Gerar
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome do afiliado</label>
                <Input
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Nome do parceiro"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Email (opcional)</label>
                <Input
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="email@parceiro.com"
                  type="email"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Limite de usos</label>
                <Input
                  value={maxUses}
                  onChange={(e) => setMaxUses(Number(e.target.value) || 20)}
                  type="number"
                  min={1}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={createCode} disabled={saving}>
                {saving ? "Criando..." : "Criar código"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista de códigos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <p className="text-muted-foreground col-span-full text-center py-8">Carregando...</p>
        ) : codes.length === 0 ? (
          <p className="text-muted-foreground col-span-full text-center py-8">Nenhum código criado ainda.</p>
        ) : (
          codes.map((c) => (
            <Card key={c.id} className={!c.active ? "opacity-50" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-mono">{c.code}</CardTitle>
                  <Badge variant={c.active ? "default" : "secondary"}>
                    {c.active ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
                <CardDescription>{c.owner_name}{c.owner_email ? ` · ${c.owner_email}` : ""}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Users className="h-4 w-4" />
                    Cadastros
                  </span>
                  <span className="font-semibold">
                    {c.current_uses} / {c.max_uses}
                    {c.current_uses >= c.max_uses && (
                      <Badge variant="destructive" className="ml-2 text-xs">Esgotado</Badge>
                    )}
                  </span>
                </div>

                {/* Barra de progresso */}
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      c.current_uses >= c.max_uses ? "bg-red-500" : "bg-primary"
                    }`}
                    style={{ width: `${Math.min((c.current_uses / c.max_uses) * 100, 100)}%` }}
                  />
                </div>

                <div className="flex gap-1.5 pt-1">
                  <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => copyLink(c.code)}>
                    <Copy className="h-3 w-3" />
                    Copiar link
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => loadReferrals(c.code)}>
                    <Eye className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => toggleActive(c.id, c.active)}>
                    {c.active ? "Desativar" : "Ativar"}
                  </Button>
                </div>
                <div className="flex pt-1">
                  <Button size="sm" variant="destructive" className="w-full gap-1" onClick={() => deleteCode(c.id)}>
                    <Trash2 className="h-3 w-3" />
                    Excluir código
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Referrals do código selecionado */}
      {selectedCode && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="h-5 w-5" />
                  Cadastros via {selectedCode}
                </CardTitle>
                <CardDescription>{referrals.length} cadastro(s) registrado(s)</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelectedCode(null)}>
                Fechar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {referrals.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">Nenhum cadastro ainda com este código.</p>
            ) : (
              <div className="space-y-2">
                {referrals.map((r) => (
                  <div key={r.id} className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/50">
                    <span className="text-sm font-medium">{r.referred_email || "Email não informado"}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString("pt-BR")} às{" "}
                      {new Date(r.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
