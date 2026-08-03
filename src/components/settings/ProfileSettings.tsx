import { useEffect, useState } from "react";
import { Loader2, Save, KeyRound, User as UserIcon } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import { maskPhone } from "@/lib/formatters";

export default function ProfileSettings() {
  const { user } = useAuth();

  // Dados do profile
  const [nome, setNome] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Trocar senha
  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles" as any)
        .select("nome, phone, whatsapp")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const p: any = data || {};
      setNome(p.nome || "");
      setPhone(p.phone ? maskPhone(p.phone) : "");
      setWhatsapp(p.whatsapp ? maskPhone(p.whatsapp) : "");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  async function saveProfile() {
    if (!user?.id) return;
    if (!nome.trim()) {
      toast({ title: "Informe o nome", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles" as any)
      .update({
        nome: nome.trim(),
        phone: phone.replace(/\D+/g, "") || null,
        whatsapp: whatsapp.replace(/\D+/g, "") || null,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Perfil atualizado" });
  }

  async function changePassword() {
    if (pwd1.length < 6) {
      toast({ title: "Senha curta", description: "Use ao menos 6 caracteres.", variant: "destructive" });
      return;
    }
    if (pwd1 !== pwd2) {
      toast({ title: "Senhas não coincidem", variant: "destructive" });
      return;
    }
    setSavingPwd(true);
    const { error } = await supabase.auth.updateUser({ password: pwd1 });
    setSavingPwd(false);
    if (error) {
      toast({ title: "Erro ao alterar senha", description: error.message, variant: "destructive" });
      return;
    }
    setPwd1(""); setPwd2("");
    toast({ title: "Senha alterada" });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Bloco 1: Dados pessoais */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <UserIcon className="h-4 w-4 text-blue-400" />
          <h2 className="text-lg font-semibold">Seus dados</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Estas informações aparecem nas OS e vendas que você cria, e em mensagens enviadas pelo sistema.
        </p>

        <div className="space-y-4">
          <div>
            <Label>Nome completo *</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="João da Silva" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>E-mail</Label>
              <Input value={user?.email || ""} disabled />
              <div className="text-[11px] text-muted-foreground mt-1">
                Pra trocar o e-mail, fale com o admin da empresa.
              </div>
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(maskPhone(e.target.value))}
                placeholder="(11) 90000-0000"
              />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <Input
                value={whatsapp}
                onChange={(e) => setWhatsapp(maskPhone(e.target.value))}
                placeholder="(11) 90000-0000"
              />
              <div className="text-[11px] text-muted-foreground mt-1">
                Recebe notificações automáticas (ex: nova OS atribuída).
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar
            </Button>
          </div>
        </div>
      </section>

      <Separator />

      {/* Bloco 2: Trocar senha */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="h-4 w-4 text-amber-400" />
          <h2 className="text-lg font-semibold">Alterar senha</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          A nova senha vale a partir do próximo login.
        </p>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Nova senha</Label>
              <Input
                type="password"
                value={pwd1}
                onChange={(e) => setPwd1(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                autoComplete="new-password"
              />
            </div>
            <div>
              <Label>Confirmar senha</Label>
              <Input
                type="password"
                value={pwd2}
                onChange={(e) => setPwd2(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={changePassword} disabled={savingPwd || !pwd1 || !pwd2}>
              {savingPwd ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <KeyRound className="h-4 w-4 mr-1" />}
              Alterar senha
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
