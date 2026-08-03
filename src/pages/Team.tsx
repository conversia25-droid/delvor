import { useEffect, useMemo, useState } from "react";
import {
  Users,
  ShieldCheck,
  UserCog,
  ShoppingCart,
  Wrench,
  User as UserIcon,
  Plus,
  Loader2,
  RefreshCw,
  Percent,
  Crown,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { maskPhone } from "@/lib/formatters";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AppRole = "super_admin" | "admin" | "gerente" | "vendedor" | "tecnico" | "user";

/**
 * Roles "atribuíveis" — o que aparece nos checkboxes de criação/edição.
 * Excluímos:
 *  - super_admin: só plataforma define
 *  - user: legado, vira "vendedor" implícito
 */
const ASSIGNABLE_ROLES: AppRole[] = ["admin", "gerente", "vendedor", "tecnico"];

type TeamMember = {
  id: string;
  nome: string;
  email: string;
  /** Lista de papéis — um usuário pode ser tecnico+vendedor, por exemplo. */
  roles: AppRole[];
  commission_rate: number;
};

const ROLE_INFO: Record<AppRole, { label: string; description: string; icon: any; tone: string }> = {
  super_admin: { label: "Super Admin", description: "Operador da plataforma Delvor",              icon: Crown,        tone: "bg-blue-500/15 text-blue-300 ring-blue-500/30" },
  admin:       { label: "Admin",       description: "Acesso total, configurações, equipe",         icon: ShieldCheck,  tone: "bg-blue-500/15 text-blue-300 ring-blue-500/30" },
  gerente:     { label: "Gerente",     description: "Vê tudo, gerencia equipe, sem configurações", icon: UserCog,      tone: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  vendedor:    { label: "Vendedor",    description: "Suas vendas + suas OS, atende WhatsApp",      icon: ShoppingCart, tone: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  tecnico:     { label: "Técnico",     description: "Só OS atribuídas a ele, executa serviços",    icon: Wrench,       tone: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  user:        { label: "Usuário",     description: "Papel legado (equivale a Vendedor)",          icon: UserIcon,     tone: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30" },
};

export default function Team() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole("admin") || hasRole("super_admin");
  const companyId = user?.company_id;

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [savingComm, setSavingComm] = useState<string | null>(null);

  // Dialog de criar
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  // Múltiplas roles — pode marcar tecnico+vendedor pra quem faz os dois trabalhos
  const [roles, setRoles] = useState<AppRole[]>(["vendedor"]);
  const [commissionRate, setCommissionRate] = useState("");
  const [creating, setCreating] = useState(false);

  function toggleRoleInDialog(r: AppRole) {
    setRoles((arr) => (arr.includes(r) ? arr.filter((x) => x !== r) : [...arr, r]));
  }

  async function load() {
    if (!companyId) return;
    setLoading(true);

    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, nome, email, commission_rate")
      .eq("company_id", companyId)
      .order("nome");

    if (error) {
      toast({ title: "Erro ao carregar equipe", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const ids = ((profiles as any[]) ?? []).map((p) => p.id);
    const { data: rolesData } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", ids);

    // Agrupa TODAS as roles por user (em vez de pegar a "mais alta") — agora
    // suportamos cumulação tipo tecnico+vendedor.
    const rolesByUser = new Map<string, AppRole[]>();
    ((rolesData as any[]) ?? []).forEach((r) => {
      const arr = rolesByUser.get(r.user_id) ?? [];
      if (!arr.includes(r.role)) arr.push(r.role as AppRole);
      rolesByUser.set(r.user_id, arr);
    });

    // Ordena as roles dentro de cada usuário pela "importância" (visual)
    const priority: Record<AppRole, number> = {
      super_admin: 6, admin: 5, gerente: 4, vendedor: 3, tecnico: 2, user: 1,
    };
    const sortRoles = (rs: AppRole[]) =>
      [...rs].sort((a, b) => (priority[b] || 0) - (priority[a] || 0));

    setMembers(((profiles as any[]) ?? []).map((p) => ({
      id: p.id,
      nome: p.nome,
      email: p.email,
      roles: sortRoles(rolesByUser.get(p.id) || ["user"]),
      commission_rate: Number(p.commission_rate) || 0,
    })));
    setLoading(false);
  }

  /* salva a comissão de um membro (edição inline na lista) */
  async function saveCommission(member: TeamMember, raw: string) {
    const rate = Math.max(0, Math.min(100, parseFloat(String(raw).replace(",", ".")) || 0));
    if (rate === member.commission_rate) return;
    setSavingComm(member.id);
    const { error } = await supabase
      .from("profiles")
      .update({ commission_rate: rate } as any)
      .eq("id", member.id);
    setSavingComm(null);
    if (error) {
      toast({ title: "Erro ao salvar comissão", description: error.message, variant: "destructive" });
      return;
    }
    setMembers((arr) => arr.map((m) => (m.id === member.id ? { ...m, commission_rate: rate } : m)));
    toast({ title: "Comissão atualizada", description: `${member.nome}: ${rate}%` });
  }

  useEffect(() => { load(); }, [companyId]);

  async function createMember() {
    if (!nome.trim() || !email.trim() || !password) {
      toast({ title: "Preencha todos os campos", variant: "destructive" });
      return;
    }
    if (roles.length === 0) {
      toast({ title: "Marque pelo menos 1 papel", variant: "destructive" });
      return;
    }
    setCreating(true);
    // A edge function `admin-create-user` aceita 1 role só.
    // Estratégia: cria com a primeira (a mais "alta", já que o array tá ordenado),
    // depois inserimos as adicionais direto no user_roles.
    const sortedRoles = [...roles].sort((a, b) => {
      const p: Record<AppRole, number> = { super_admin: 6, admin: 5, gerente: 4, vendedor: 3, tecnico: 2, user: 1 };
      return (p[b] || 0) - (p[a] || 0);
    });
    const primary = sortedRoles[0];
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: {
        nome: nome.trim(),
        email: email.trim().toLowerCase(),
        password,
        role: primary,
        phone: phone.replace(/\D+/g, "") || null,
        whatsapp: whatsapp.replace(/\D+/g, "") || null,
      },
    });
    setCreating(false);
    if (error) {
      toast({ title: "Erro ao criar usuário", description: error.message, variant: "destructive" });
      return;
    }
    if ((data as any)?.error) {
      toast({ title: "Erro ao criar usuário", description: (data as any).error, variant: "destructive" });
      return;
    }

    const newId = (data as any)?.id;

    // Insere as roles adicionais (do índice 1 em diante)
    const additional = sortedRoles.slice(1);
    if (newId && additional.length && companyId) {
      const { error: addErr } = await supabase.from("user_roles").insert(
        additional.map((r) => ({ user_id: newId, role: r, company_id: companyId }))
      );
      if (addErr) {
        toast({ title: "Usuário criado, mas falhou ao adicionar papéis extras", description: addErr.message, variant: "destructive" });
      }
    }

    const roleLabels = sortedRoles.map((r) => ROLE_INFO[r].label).join(" + ");
    toast({ title: "Usuário criado", description: `${nome} (${roleLabels}) adicionado à equipe.` });

    // grava a comissão do novo membro (a edge function não trata esse campo)
    const rate = Math.max(0, Math.min(100, parseFloat(commissionRate.replace(",", ".")) || 0));
    if (newId && rate > 0) {
      await supabase.from("profiles").update({ commission_rate: rate } as any).eq("id", newId);
    }

    setOpen(false);
    setNome(""); setEmail(""); setPassword(""); setPhone(""); setWhatsapp(""); setRoles(["vendedor"]); setCommissionRate("");
    load();
  }

  /**
   * Substitui o conjunto de papéis do usuário. Recebe array — pode marcar
   * tecnico+vendedor, ou só admin, ou o que precisar.
   */
  async function changeRoles(member: TeamMember, newRoles: AppRole[]) {
    if (!isAdmin || !companyId) return;
    if (member.id === user?.id) {
      toast({ title: "Você não pode alterar seu próprio papel", variant: "destructive" });
      return;
    }
    // Nunca deixa o usuário sem papel nenhum — cai pra "user" (vendedor legado)
    const target = newRoles.length > 0 ? newRoles : ["user" as AppRole];
    // Sem mudança? sai.
    const same =
      target.length === member.roles.length &&
      target.every((r) => member.roles.includes(r));
    if (same) return;

    setChangingRole(member.id);
    const { error: delErr } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", member.id)
      .eq("company_id", companyId);
    if (delErr) {
      setChangingRole(null);
      toast({ title: "Erro", description: delErr.message, variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("user_roles").insert(
      target.map((r) => ({ user_id: member.id, role: r, company_id: companyId }))
    );
    setChangingRole(null);
    if (error) {
      toast({ title: "Erro ao alterar papéis", description: error.message, variant: "destructive" });
      return;
    }
    // Re-ordena pela prioridade pra UI ficar consistente
    const priority: Record<AppRole, number> = {
      super_admin: 6, admin: 5, gerente: 4, vendedor: 3, tecnico: 2, user: 1,
    };
    const sorted = [...target].sort((a, b) => (priority[b] || 0) - (priority[a] || 0));
    setMembers((arr) => arr.map((m) => (m.id === member.id ? { ...m, roles: sorted } : m)));
    const labels = sorted.map((r) => ROLE_INFO[r].label).join(" + ");
    toast({ title: "Papéis alterados", description: `${member.nome}: ${labels}` });
  }

  const counts = useMemo(() => {
    // Cada role conta separadamente — se um user é tecnico+vendedor, soma em ambos.
    const c: Record<AppRole, number> = { super_admin: 0, admin: 0, gerente: 0, vendedor: 0, tecnico: 0, user: 0 };
    members.forEach((m) => m.roles.forEach((r) => { c[r] = (c[r] || 0) + 1; }));
    return c;
  }, [members]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-7 w-7" /> Equipe
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cadastre vendedores, técnicos e gestores. Cada papel vê e edita só o que precisa.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} title="Recarregar"><RefreshCw className="h-4 w-4" /></Button>
          {isAdmin && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" /> Novo membro</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Cadastrar novo membro</DialogTitle>
                  <DialogDescription>
                    O usuário recebe acesso imediato. Você pode mudar a permissão depois.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Nome completo *</Label>
                    <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="João da Silva" />
                  </div>
                  <div>
                    <Label>E-mail *</Label>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div>
                    <Label>Senha temporária *</Label>
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
                    <div className="text-xs text-muted-foreground mt-1">Peça pra ele trocar no primeiro login.</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
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
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Recebe notificações de OS.
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label>Papéis * <span className="text-[10px] text-muted-foreground font-normal">(pode marcar mais de um)</span></Label>
                    <div className="space-y-1.5 mt-1">
                      {ASSIGNABLE_ROLES.map((r) => {
                        const info = ROLE_INFO[r];
                        const Icon = info.icon;
                        const checked = roles.includes(r);
                        return (
                          <label
                            key={r}
                            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition ${
                              checked ? "border-blue-500 bg-blue-500/5" : "border-border/60 hover:bg-muted/30"
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleRoleInDialog(r)}
                              className="mt-0.5"
                            />
                            <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                            <div className="flex-1">
                              <div className="font-medium text-sm">{info.label}</div>
                              <div className="text-[11px] text-muted-foreground">{info.description}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1.5">
                      Combine papéis quando uma pessoa faz mais de uma função. Ex: técnico que também vende.
                    </div>
                  </div>
                  <div>
                    <Label className="flex items-center gap-1">
                      <Percent className="h-3.5 w-3.5" /> Comissão padrão (%)
                    </Label>
                    <Input
                      inputMode="decimal"
                      value={commissionRate}
                      onChange={(e) => setCommissionRate(e.target.value)}
                      placeholder="0"
                    />
                    <div className="text-xs text-muted-foreground mt-1">
                      Percentual usado pra calcular a comissão das vendas dele. Pode deixar em branco e ajustar depois.
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>Cancelar</Button>
                  <Button onClick={createMember} disabled={creating}>
                    {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Criar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* KPIs por papel */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["admin", "gerente", "vendedor", "tecnico"] as AppRole[]).map((r) => {
          const info = ROLE_INFO[r];
          const Icon = info.icon;
          return (
            <div key={r} className="rounded-lg border bg-card p-4 flex items-start gap-3">
              <div className={`rounded-full p-2 ring-1 ${info.tone}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{info.label}</div>
                <div className="text-2xl font-bold">{counts[r]}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lista */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead className="w-32">Comissão</TableHead>
              <TableHead className="w-56">Papel</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
            )}
            {!loading && members.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">Nenhum membro.</TableCell></TableRow>
            )}
            {!loading && members.map((m) => {
              const isMe = m.id === user?.id;
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {m.nome} {isMe && <Badge variant="outline" className="ml-1 text-[10px]">você</Badge>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <div className="flex items-center gap-1">
                        <Input
                          key={`comm-${m.id}-${m.commission_rate}`}
                          type="number"
                          min={0}
                          max={100}
                          step="0.5"
                          defaultValue={m.commission_rate}
                          disabled={savingComm === m.id}
                          onBlur={(e) => saveCommission(m, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          className="h-8 w-16 text-right"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                        {savingComm === m.id && <Loader2 className="h-3 w-3 animate-spin" />}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">{m.commission_rate}%</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <RolesCell
                      member={m}
                      canEdit={isAdmin && !isMe}
                      busy={changingRole === m.id}
                      onChange={(rs) => changeRoles(m, rs)}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {!isAdmin && (
        <div className="text-xs text-muted-foreground">
          Apenas administradores podem cadastrar ou alterar permissões.
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   RolesCell — célula de papéis com badges + Popover de edição (checkboxes).
═══════════════════════════════════════════════════════════════════════════ */
function RolesCell({
  member,
  canEdit,
  busy,
  onChange,
}: {
  member: TeamMember;
  canEdit: boolean;
  busy: boolean;
  onChange: (rs: AppRole[]) => void;
}) {
  const [open, setOpen] = useState(false);
  // Estado local do popover — só commit ao clicar "Salvar" pra evitar
  // 1 UPDATE por checkbox marcado (rede + race condition).
  const [draft, setDraft] = useState<AppRole[]>(member.roles);

  useEffect(() => { setDraft(member.roles); }, [member.roles, open]);

  // Renderiza só os badges quando não editável (ou é a própria linha do user)
  const Badges = (
    <div className="flex flex-wrap gap-1">
      {member.roles.map((r) => {
        const info = ROLE_INFO[r] ?? ROLE_INFO.user;
        const Icon = info.icon;
        return (
          <Badge key={r} className={`${info.tone} ring-1 text-[10px]`}>
            <Icon className="h-3 w-3 mr-1" /> {info.label}
          </Badge>
        );
      })}
    </div>
  );

  if (!canEdit) return Badges;

  function toggle(r: AppRole) {
    setDraft((arr) => (arr.includes(r) ? arr.filter((x) => x !== r) : [...arr, r]));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={busy}
          className="hover:bg-muted/30 -mx-1 px-1 py-0.5 rounded transition disabled:opacity-50"
          title="Clique pra editar papéis"
        >
          {Badges}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <div className="px-2 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Editar papéis de {member.nome.split(" ")[0]}
        </div>
        <div className="space-y-1">
          {ASSIGNABLE_ROLES.map((r) => {
            const info = ROLE_INFO[r];
            const Icon = info.icon;
            const checked = draft.includes(r);
            return (
              <label
                key={r}
                className={`flex items-start gap-2.5 rounded-md p-2 cursor-pointer transition ${
                  checked ? "bg-blue-500/10" : "hover:bg-muted/40"
                }`}
              >
                <Checkbox checked={checked} onCheckedChange={() => toggle(r)} className="mt-0.5" />
                <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{info.label}</div>
                  <div className="text-[11px] text-muted-foreground">{info.description}</div>
                </div>
              </label>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t mt-2">
          <Button variant="ghost" size="sm" onClick={() => { setDraft(member.roles); setOpen(false); }}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={() => { onChange(draft); setOpen(false); }}
            disabled={draft.length === 0 || busy}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Salvar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
