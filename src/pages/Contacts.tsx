import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Trash2,
  MessageCircle,
  User,
  Calendar,
  MoreHorizontal,
  Pencil,
  Plus,
  ArrowUpDown,
  Lock,
  EyeOff,
  MapPin,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { useAuth } from "@/contexts/AuthContext";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { supabase } from "@/integrations/supabase/client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";

/* ======================================================
   TIPOS
====================================================== */
type ContactRow = {
  id: string;
  lead_code: string | null;
  lead_name: string | null;
  email: string | null;
  remote_jid: string;
  source: string | null;
  created_at: string;
  company_id: string;
  assigned_user_id: string | null;
};

type Funnel = { id: string; name: string };
type UserOption = { id: string; nome: string };
type InstanceOption = { id: string; name: string; phone: string | null };

// Opções de ordenação
type SortOrder = "newest" | "oldest" | "az" | "za";

/* ======================================================
   HELPERS
====================================================== */
function formatPhone(jid: string) {
  const clean = jid.replace("@s.whatsapp.net", "").replace(/\D/g, "");
  if (clean.startsWith("55") && clean.length >= 12) {
    const ddd = clean.substring(2, 4);
    const part1 = clean.substring(4, 9);
    const part2 = clean.substring(9);
    return `(${ddd}) ${part1}-${part2}`;
  }
  return clean;
}

// NOVO HELPER: Remove acentos de uma string
function removeAccents(str: string) {
  if (!str) return "";
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/* Mapa DDD → UF */
const DDD_TO_UF: Record<string, string> = {
  "11":"SP","12":"SP","13":"SP","14":"SP","15":"SP","16":"SP","17":"SP","18":"SP","19":"SP",
  "21":"RJ","22":"RJ","24":"RJ",
  "27":"ES","28":"ES",
  "31":"MG","32":"MG","33":"MG","34":"MG","35":"MG","37":"MG","38":"MG",
  "41":"PR","42":"PR","43":"PR","44":"PR","45":"PR","46":"PR",
  "47":"SC","48":"SC","49":"SC",
  "51":"RS","53":"RS","54":"RS","55":"RS",
  "61":"DF",
  "62":"GO","64":"GO",
  "63":"TO",
  "65":"MT","66":"MT",
  "67":"MS",
  "68":"AC",
  "69":"RO",
  "71":"BA","73":"BA","74":"BA","75":"BA","77":"BA",
  "79":"SE",
  "81":"PE","87":"PE",
  "82":"AL",
  "83":"PB",
  "84":"RN",
  "85":"CE","88":"CE",
  "86":"PI","89":"PI",
  "91":"PA","93":"PA","94":"PA",
  "92":"AM","97":"AM",
  "95":"RR",
  "96":"AP",
  "98":"MA","99":"MA",
};

function getUfFromJid(jid: string): string | null {
  const clean = jid.replace("@s.whatsapp.net", "").replace(/\D/g, "");
  let ddd: string | null = null;

  if (clean.startsWith("55") && clean.length >= 12) {
    // formato internacional: 5511999999999
    ddd = clean.substring(2, 4);
  } else if (!clean.startsWith("55") && clean.length >= 10 && clean.length <= 11) {
    // formato nacional sem DDI: 11999999999 ou 1199999999
    ddd = clean.substring(0, 2);
  }

  if (!ddd) return null;
  return DDD_TO_UF[ddd] || null;
}

export default function Contacts() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const companyId = user?.company_id;
  
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isOnboarding, currentStep, completeStep } = useOnboarding();
  const isContactOnboardingStep = isOnboarding && currentStep === 3;

  // JID do contato recém-criado durante onboarding (para highlight)
  const [onboardingCreatedJid, setOnboardingCreatedJid] = useState<string | null>(null);

  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterUf, setFilterUf] = useState<string>("all");

  // Estado para ordenação
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  // Estados de Paginação
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | "all">(500);

  // Estado para exclusão
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Estado para edição
  const [editContact, setEditContact] = useState<ContactRow | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState(""); // <-- NOVO ESTADO ADICIONADO
  const [newEditEmail, setNewEditEmail] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  /* =======================
     ESTADOS NOVO CONTATO (LEAD)
  ======================= */
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [instances, setInstances] = useState<InstanceOption[]>([]);
  
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newLeadName, setNewLeadName] = useState("");
  const [newLeadEmail, setNewLeadEmail] = useState("");
  const [phonePrefix, setPhonePrefix] = useState("55");
  const [newLeadPhone, setNewLeadPhone] = useState("");
  const [newLeadSource, setNewLeadSource] = useState("");
  const [newLeadInstanceId, setNewLeadInstanceId] = useState<string>("");
  const [newLeadAssignedUserId, setNewLeadAssignedUserId] = useState<string>("none");
  const [selectedFunnelId, setSelectedFunnelId] = useState<string>("");
  const [isCreating, setIsCreating] = useState(false);

  // Conversa borrada (sem acesso)
  const [blurContact, setBlurContact] = useState<ContactRow | null>(null);
  const [blurMessages, setBlurMessages] = useState<{ id: string; message: string | null; from_me: boolean; created_at: string }[]>([]);
  const [blurLoading, setBlurLoading] = useState(false);

  /* ======================================================
     CARREGAR DADOS INICIAIS (Funis, Instâncias, Usuários)
  ====================================================== */
  useEffect(() => {
    if (!companyId) return;

    supabase
      .from("funnels")
      .select("id,name")
      .eq("company_id", companyId)
      .order("created_at")
      .then(({ data }) => {
        if (data && data.length > 0) {
          setFunnels(data);
          setSelectedFunnelId(data[0].id);
        }
      });

    supabase
      .from("instancias")
      .select("id, instance_name, phone_number")
      .eq("company_id", companyId)
      .eq("status", "CONNECTED")
      .then(({ data }) => {
        if (data) {
          const formatted = data.map((i: any) => ({
            id: i.id,
            name: i.instance_name,
            phone: i.phone_number ? String(i.phone_number) : null,
          }));
          setInstances(formatted);
        }
      });
  }, [companyId]);

  useEffect(() => {
    if (!isAdmin || !companyId) return;
    
    supabase
      .from("profiles")
      .select("id,nome")
      .eq("company_id", companyId)
      .order("nome")
      .then(({ data }) => setUsers(data || []));
  }, [isAdmin, companyId]);

  /* ======================================================
     CONVERSA BORRADA
  ====================================================== */
  async function openBlurConversation(contact: ContactRow) {
    setBlurContact(contact);
    setBlurMessages([]);
    setBlurLoading(true);
    try {
      const { data } = await supabase
        .from("wpp_conversations")
        .select("id, message, from_me, created_at")
        .eq("company_id", companyId)
        .eq("remote_jid", contact.remote_jid)
        .order("created_at", { ascending: true })
        .limit(60);
      setBlurMessages((data || []) as { id: string; message: string | null; from_me: boolean; created_at: string }[]);
    } catch {
      // silencia erro — apenas mostra vazio
    } finally {
      setBlurLoading(false);
    }
  }

  /* ======================================================
     CARREGAR CONTATOS
  ====================================================== */
  async function loadContacts() {
    if (!companyId) return;
    setLoading(true);

    try {
      let allLeads: ContactRow[] = [];
      let from = 0;
      const step = 1000;

      while (true) {
        const { data, error } = await supabase
          .from("leads")
          .select("id, lead_code, lead_name, email, remote_jid, source, created_at, company_id, assigned_user_id")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }) // tiebreaker: garante paginacao estavel mesmo com created_at iguais
          .range(from, from + step - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        allLeads = [...allLeads, ...data];
        if (data.length < step) break;
        from += step;
      }

      // Dedupe por id (defesa contra qualquer chunk duplicado vindo do Supabase)
      const seen = new Set<string>();
      const deduped = allLeads.filter((l) => {
        if (seen.has(l.id)) return false;
        seen.add(l.id);
        return true;
      });

      setContacts(deduped);
    } catch (error) {
      console.error("Erro ao carregar contatos:", error);
      toast({ variant: "destructive", title: "Erro", description: "Falha ao carregar contatos." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadContacts();
  }, [companyId]);

  /* ======================================================
     FILTRAGEM, ORDENAÇÃO E PAGINAÇÃO
  ====================================================== */

  // Volta para a página 1 se mudar filtro, ordem ou limite por página
  useEffect(() => {
    setCurrentPage(1);
  }, [search, sortOrder, pageSize, filterUf]);

  // Lista de UFs presentes nos contatos (para popular o dropdown)
  const availableUfs = useMemo(
    () =>
      Array.from(
        new Set(contacts.map((c) => getUfFromJid(c.remote_jid)).filter(Boolean) as string[])
      ).sort(),
    [contacts]
  );

  // Filtra e ordena TODOS os contatos (memoizado — só re-roda se mudar a base ou os filtros)
  const filteredAndSortedContacts = useMemo(() => {
    const rawTerm = search.trim();

    // Detecta se o usuário está buscando por TELEFONE (digitou só números/+ ou parecido)
    // Senão, busca por NOME
    const isPhoneSearch = /^[\d\s\+\-\(\)]+$/.test(rawTerm) && rawTerm.replace(/\D/g, "").length >= 3;
    const searchDigits = isPhoneSearch ? rawTerm.replace(/\D/g, "") : "";

    // Para busca por nome: normaliza (sem acentos, lowercase, sem espaços extras)
    const nameTerm = isPhoneSearch ? "" : removeAccents(rawTerm.toLowerCase()).replace(/\s+/g, " ").trim();
    const nameWords = nameTerm.split(" ").filter((w) => w.length > 0);

    return contacts
      .filter((c) => {
        // 1) Filtro por UF (sempre aplica)
        if (filterUf !== "all") {
          const uf = getUfFromJid(c.remote_jid);
          if (filterUf === "other") {
            if (uf !== null) return false;
          } else {
            if (uf !== filterUf) return false;
          }
        }

        // 2) Sem termo de busca → mostra tudo (passou no filtro UF)
        if (!rawTerm) return true;

        // 3) Busca por telefone (modo dígitos)
        if (isPhoneSearch) {
          const phone = (c.remote_jid || "").replace(/\D/g, "");
          return phone.includes(searchDigits);
        }

        // 4) Busca por nome (só lead_name, sem fallback pra lead_code)
        if (nameWords.length === 0) return true;
        const rawName = (c.lead_name || "").toString();
        if (!rawName) return false; // se não tem nome, não casa em busca textual
        const name = removeAccents(rawName.toLowerCase()).replace(/\s+/g, " ").trim();
        // TODAS as palavras digitadas precisam estar no nome (AND)
        return nameWords.every((w) => name.includes(w));
      })
      .sort((a, b) => {
        if (sortOrder === "newest") {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
        if (sortOrder === "oldest") {
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        }

        const nameA = removeAccents((a.lead_name || a.lead_code || "Sem nome").toLowerCase());
        const nameB = removeAccents((b.lead_name || b.lead_code || "Sem nome").toLowerCase());

        if (sortOrder === "az") return nameA.localeCompare(nameB);
        if (sortOrder === "za") return nameB.localeCompare(nameA);
        return 0;
      });
  }, [contacts, search, filterUf, sortOrder]);

  // Fatiar array para a página atual (PAGINAÇÃO)
  const totalItems = filteredAndSortedContacts.length;
  const totalPages = pageSize === "all" ? 1 : Math.ceil(totalItems / pageSize);

  const startIndex = pageSize === "all" ? 0 : (currentPage - 1) * pageSize;
  const endIndex = pageSize === "all" ? totalItems : startIndex + pageSize;

  const paginatedContacts = filteredAndSortedContacts.slice(startIndex, endIndex);

  /* ======================================================
     AÇÃO: CRIAR CONTATO
  ====================================================== */
  async function handleCreateContact() {
    if (!newLeadName || !newLeadPhone || !selectedFunnelId) {
      toast({ variant: "destructive", title: "Atenção", description: "Preencha o nome, telefone e funil." });
      return;
    }

    if (instances.length > 0 && !newLeadInstanceId) {
      toast({ variant: "destructive", title: "Atenção", description: "Selecione uma instância conectada." });
      return;
    }

    const selectedInstance = instances.find((i) => i.id === newLeadInstanceId) || null;
    const instanceKeyName = selectedInstance?.name || "";
    const normalizedSource = (instanceKeyName || newLeadSource || "").trim();

    const fullPhone = `${phonePrefix}${newLeadPhone}`;
    const cleanPhone = fullPhone.replace(/\D/g, "");

    let assignedUserIdToSave = null;
    if (isAdmin) {
      assignedUserIdToSave = newLeadAssignedUserId !== "none" ? newLeadAssignedUserId : null;
    } else {
      assignedUserIdToSave = user?.id || null;
    }

    try {
      setIsCreating(true);

      // 1) Checa se já existe um lead com esse telefone (pode ter sido criado automaticamente
      //    quando chegou uma mensagem do WhatsApp — nesse caso lead_name vem null e lead_code = jid)
      const { data: existing, error: findError } = await supabase
        .from("leads")
        .select("id, lead_name, email")
        .eq("company_id", companyId)
        .eq("remote_jid", cleanPhone)
        .maybeSingle();

      if (findError) throw findError;

      if (existing) {
        // 2a) Já existe: atualiza os campos preenchidos (sem sobrescrever nome/email
        //     caso o usuário tenha deixado em branco — mas aqui o nome é obrigatório, então sempre atualiza)
        const { error: updateError } = await supabase
          .from("leads")
          .update({
            lead_name: newLeadName,
            email: newLeadEmail.trim() || existing.email || null,
            current_funnel_id: selectedFunnelId,
            source: normalizedSource || null,
            instance_key: instanceKeyName,
            send_instance_key: instanceKeyName,
            assigned_user_id: assignedUserIdToSave,
          })
          .eq("id", existing.id);

        if (updateError) throw updateError;

        toast({ title: "Contato atualizado", description: "Esse número já estava cadastrado — atualizamos os dados." });
      } else {
        // 2b) Novo: cria do zero
        const { error } = await supabase.from("leads").insert({
          company_id: companyId,
          lead_name: newLeadName,
          email: newLeadEmail.trim() || null,
          remote_jid: cleanPhone,
          current_funnel_id: selectedFunnelId,
          source: normalizedSource || null,
          instance_key: instanceKeyName,
          send_instance_key: instanceKeyName,
          assigned_user_id: assignedUserIdToSave,
        });

        if (error) throw error;

        toast({ title: "Sucesso", description: "Contato criado com sucesso!" });
      }

      setNewLeadName("");
      setNewLeadEmail("");
      setNewLeadPhone("");
      setPhonePrefix("55");
      setNewLeadSource("");
      setNewLeadInstanceId("");
      setNewLeadAssignedUserId("none");
      setIsCreateOpen(false);

      loadContacts();

      if (isContactOnboardingStep) {
        // Durante onboarding: não navega direto, mostra highlight para o usuário clicar
        setOnboardingCreatedJid(cleanPhone);
      } else {
        navigate(`/chat?jid=${cleanPhone}`);
      }

    } catch (error) {
      console.error("Erro ao criar contato:", error);
      toast({ variant: "destructive", title: "Erro", description: "Falha ao criar contato." });
    } finally {
      setIsCreating(false);
    }
  }

  /* ======================================================
     AÇÃO: EXCLUIR
  ====================================================== */
  async function handleDelete() {
    if (!deleteId || !isAdmin || !companyId) return;

    try {
      setIsDeleting(true);
      const { error } = await supabase
        .from("leads")
        .delete()
        .eq("id", deleteId)
        .eq("company_id", companyId);

      if (error) throw error;

      toast({
        title: "Contato excluído",
        description: "O lead foi removido com sucesso.",
      });

      setContacts((prev) => prev.filter((c) => c.id !== deleteId));
      
    } catch (error) {
      console.error("Erro ao excluir:", error);
      toast({
        variant: "destructive",
        title: "Erro ao excluir",
        description: "Não foi possível remover o contato.",
      });
    } finally {
      setIsDeleting(false);
      setDeleteId(null);
    }
  }

  /* ======================================================
     AÇÃO: EDITAR DADOS (NOME E TELEFONE)
  ====================================================== */
  function openEditDialog(contact: ContactRow) {
    setEditContact(contact);
    setNewName(contact.lead_name || contact.lead_code || "");
    setNewEditEmail(contact.email || "");
    // Extrai apenas os números para facilitar a edição
    setNewPhone((contact.remote_jid || "").replace(/\D/g, ""));
  }

  async function handleSaveEdit() {
    if (!editContact || !companyId) return;

    try {
      setIsSaving(true);
      const cleanPhone = newPhone.replace(/\D/g, "");

      const cleanEmail = newEditEmail.trim() || null;

      const { error } = await supabase
        .from("leads")
        .update({
          lead_name: newName,
          email: cleanEmail,
          remote_jid: cleanPhone
        })
        .eq("id", editContact.id)
        .eq("company_id", companyId);

      if (error) throw error;

      toast({
        title: "Contato atualizado",
        description: "Os dados do contato foram atualizados com sucesso.",
      });

      setContacts((prev) =>
        prev.map((c) =>
          c.id === editContact.id ? { ...c, lead_name: newName, email: cleanEmail, remote_jid: cleanPhone } : c
        )
      );
      
      setEditContact(null);
    } catch (error) {
      console.error("Erro ao salvar edição:", error);
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: "Não foi possível atualizar os dados.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  /* ======================================================
     COMPONENTE DE PAGINAÇÃO (REUTILIZÁVEL)
  ====================================================== */
  const paginationControls = !loading && filteredAndSortedContacts.length > 0 && (
    <div className="flex flex-col md:flex-row items-center justify-between gap-4 py-2 px-1">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Itens por página:</span>
        <Select 
          value={String(pageSize)} 
          onValueChange={(val) => setPageSize(val === "all" ? "all" : Number(val))}
        >
          <SelectTrigger className="w-[100px] h-8 bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="500">500</SelectItem>
            <SelectItem value="1000">1.000</SelectItem>
            <SelectItem value="1500">1.500</SelectItem>
            <SelectItem value="all">Todos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">
          {pageSize === "all" 
            ? `Mostrando todos os ${totalItems} itens` 
            : `Página ${currentPage} de ${totalPages} (${totalItems} totais)`
          }
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1 || pageSize === "all"}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages || totalPages === 0 || pageSize === "all"}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );

  /* ======================================================
     RENDER
  ====================================================== */
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contatos</h1>
          <p className="text-muted-foreground">
            {search.trim() || filterUf !== "all"
              ? `${filteredAndSortedContacts.length} de ${contacts.length} contatos`
              : `Diretório geral de leads da empresa (${contacts.length}).`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* SEARCH */}
          <div className="relative flex-1 md:w-72 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Buscar por nome ou telefone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-9"
              autoComplete="off"
              spellCheck={false}
            />
            {search && (
              <button
                type="button"
                aria-label="Limpar busca"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* FILTRO POR ESTADO */}
          <Select value={filterUf} onValueChange={setFilterUf}>
            <SelectTrigger className="w-[140px] bg-background">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 opacity-50" />
                <SelectValue placeholder="Estado" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos estados</SelectItem>
              {availableUfs.map((uf) => (
                <SelectItem key={uf} value={uf}>{uf}</SelectItem>
              ))}
              <SelectItem value="other">Outros / Internacional</SelectItem>
            </SelectContent>
          </Select>

          {/* ORDENAÇÃO */}
          <div className="flex items-center gap-2">
            <Select value={sortOrder} onValueChange={(val: SortOrder) => setSortOrder(val)}>
              <SelectTrigger className="w-[170px] bg-background">
                <div className="flex items-center gap-2">
                  <ArrowUpDown className="h-4 w-4 opacity-50" />
                  <SelectValue placeholder="Ordenar por" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Mais recentes</SelectItem>
                <SelectItem value="oldest">Mais antigos</SelectItem>
                <SelectItem value="az">Alfabética (A-Z)</SelectItem>
                <SelectItem value="za">Alfabética (Z-A)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* BOTÃO E MODAL DE NOVO CONTATO */}
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Novo
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adicionar Novo Contato</DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Nome do Contato</Label>
                  <Input
                    value={newLeadName}
                    onChange={(e) => setNewLeadName(e.target.value)}
                    placeholder="Ex: João Silva"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Email (opcional)</Label>
                  <Input
                    type="email"
                    value={newLeadEmail}
                    onChange={(e) => setNewLeadEmail(e.target.value)}
                    placeholder="Ex: joao@email.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label>WhatsApp (Somente números)</Label>
                  <div className="flex gap-2">
                    <Select value={phonePrefix} onValueChange={setPhonePrefix}>
                      <SelectTrigger className="w-[120px]">
                        <SelectValue placeholder="DDI" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="55">🇧🇷 BR (55)</SelectItem>
                        <SelectItem value="54">🇦🇷 AR (54)</SelectItem>
                        <SelectItem value="56">🇨🇱 CL (56)</SelectItem>
                        <SelectItem value="57">🇨🇴 CO (57)</SelectItem>
                        <SelectItem value="52">🇲🇽 MX (52)</SelectItem>
                        <SelectItem value="595">🇵🇾 PY (595)</SelectItem>
                        <SelectItem value="598">🇺🇾 UY (598)</SelectItem>
                        <SelectItem value="1">🇺🇸 US/CA (1)</SelectItem>
                        <SelectItem value="351">🇵🇹 PT (351)</SelectItem>
                        <SelectItem value="34">🇪🇸 ES (34)</SelectItem>
                        <SelectItem value="44">🇬🇧 UK (44)</SelectItem>
                        <SelectItem value="39">🇮🇹 IT (39)</SelectItem>
                        <SelectItem value="33">🇫🇷 FR (33)</SelectItem>
                        <SelectItem value="49">🇩🇪 DE (49)</SelectItem>
                        <SelectItem value="81">🇯🇵 JP (81)</SelectItem>
                        <SelectItem value="86">🇨🇳 CN (86)</SelectItem>
                        <SelectItem value="91">🇮🇳 IN (91)</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    <Input
                      className="flex-1"
                      value={newLeadPhone}
                      onChange={(e) => setNewLeadPhone(e.target.value)}
                      placeholder="Ex: 11999999999"
                      type="tel"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Funil Inicial</Label>
                  <Select value={selectedFunnelId} onValueChange={setSelectedFunnelId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o funil" />
                    </SelectTrigger>
                    <SelectContent>
                      {funnels.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Fonte (Instância)</Label>
                  <Select value={newLeadInstanceId} onValueChange={setNewLeadInstanceId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a instância conectada" />
                    </SelectTrigger>
                    <SelectContent>
                      {instances.map((inst) => {
                        const label = inst.phone 
                          ? `${inst.name} (+${inst.phone})`
                          : inst.name;
                        
                        return (
                          <SelectItem key={inst.id} value={inst.id}>
                            {label}
                          </SelectItem>
                        );
                      })}
                      {instances.length === 0 && (
                        <SelectItem value="none" disabled>
                          Nenhuma instância conectada
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {isAdmin && (
                  <div className="space-y-2">
                    <Label>Atribuir a (Opcional)</Label>
                    <Select value={newLeadAssignedUserId} onValueChange={setNewLeadAssignedUserId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o usuário responsável" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Não atribuir agora</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={isCreating}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleCreateContact}
                  disabled={isCreating || !newLeadName || !newLeadPhone}
                >
                  {isCreating ? "Salvando..." : "Salvar Contato"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* CONTROLES DE PAGINAÇÃO (Topo) */}
      {paginationControls}

      <div className="flex flex-col gap-4">
        {/* TABELA DE DADOS */}
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead className="hidden md:table-cell">Estado</TableHead>
                <TableHead className="hidden md:table-cell">Origem</TableHead>
                <TableHead className="hidden md:table-cell">Criado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    Carregando contatos...
                  </TableCell>
                </TableRow>
              ) : paginatedContacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Nenhum contato encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedContacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <User className="h-4 w-4" />
                        </div>
                        <div className="flex flex-col">
                          <span>{contact.lead_name || contact.lead_code || "Sem nome"}</span>
                        </div>
                      </div>
                    </TableCell>
                    
                    <TableCell>
                      <div className="text-sm text-muted-foreground">
                        {formatPhone(contact.remote_jid)}
                      </div>
                    </TableCell>

                    <TableCell className="hidden md:table-cell">
                      {(() => {
                        const uf = getUfFromJid(contact.remote_jid);
                        return uf ? (
                          <Badge variant="secondary" className="text-xs">{uf}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        );
                      })()}
                    </TableCell>

                    <TableCell className="hidden md:table-cell">
                      {contact.source ? (
                        <Badge variant="outline">{contact.source}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>

                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {contact.created_at
                          ? format(new Date(contact.created_at), "dd/MM/yyyy", { locale: ptBR })
                          : "-"}
                      </div>
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {isAdmin || contact.assigned_user_id === user?.id ? (
                          <div className="relative">
                            {onboardingCreatedJid && contact.remote_jid === onboardingCreatedJid && (
                              <>
                                {/* Pulse ring */}
                                <span className="absolute inset-0 rounded-md animate-ping bg-primary/30" />
                                {/* Tooltip */}
                                <div className="absolute -top-10 right-0 whitespace-nowrap bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 rounded-lg shadow-lg animate-bounce z-10">
                                  Clique aqui para abrir a conversa!
                                  <div className="absolute -bottom-1 right-4 w-2 h-2 bg-primary rotate-45" />
                                </div>
                              </>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Abrir Conversa"
                              className={onboardingCreatedJid && contact.remote_jid === onboardingCreatedJid
                                ? "relative z-10 ring-2 ring-primary ring-offset-2 rounded-md"
                                : ""
                              }
                              onClick={() => {
                                if (onboardingCreatedJid && contact.remote_jid === onboardingCreatedJid) {
                                  setOnboardingCreatedJid(null);
                                  completeStep();
                                }
                                navigate(contact.id ? `/chat?leadId=${contact.id}` : `/chat?jid=${contact.remote_jid}`);
                              }}
                            >
                              <MessageCircle className="h-4 w-4 text-blue-500" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Ver conversa (acesso restrito)"
                            onClick={() => openBlurConversation(contact)}
                          >
                            <EyeOff className="h-4 w-4 text-muted-foreground/50" />
                          </Button>
                        )}

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
  <DropdownMenuLabel>Opções</DropdownMenuLabel>
  {isAdmin || contact.assigned_user_id === user?.id ? (
    <DropdownMenuItem onClick={() => navigate(contact.id ? `/chat?leadId=${contact.id}` : `/chat?jid=${contact.remote_jid}`)}>
      <MessageCircle className="mr-2 h-4 w-4" />
      Ver no Chat
    </DropdownMenuItem>
  ) : (
    <DropdownMenuItem onClick={() => openBlurConversation(contact)}>
      <EyeOff className="mr-2 h-4 w-4" />
      Ver conversa (restrita)
    </DropdownMenuItem>
  )}
  
  {/* 👇 BLOQUEIO ADICIONADO AQUI 👇 */}
  {isAdmin && (
    <DropdownMenuItem onClick={() => openEditDialog(contact)}>
      <Pencil className="mr-2 h-4 w-4" />
      Editar Contato
    </DropdownMenuItem>
  )}

  {isAdmin && (
    <DropdownMenuItem 
      className="text-red-600 focus:text-red-600 focus:bg-red-50"
      onClick={() => setDeleteId(contact.id)}
    >
      <Trash2 className="mr-2 h-4 w-4" />
      Excluir Contato
    </DropdownMenuItem>
  )}
</DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* CONTROLES DE PAGINAÇÃO (Rodapé) */}
        {paginationControls}
      </div>

      {/* DIALOG DE EDIÇÃO (Agora com telefone liberado) */}
      <Dialog open={!!editContact} onOpenChange={(open) => !open && setEditContact(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Contato</DialogTitle>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>Nome do Lead</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex: João Silva"
              />
            </div>
            <div className="space-y-2">
              <Label>Email (opcional)</Label>
              <Input
                type="email"
                value={newEditEmail}
                onChange={(e) => setNewEditEmail(e.target.value)}
                placeholder="Ex: joao@email.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Telefone (Somente números, incluindo DDI e DDD)</Label>
              <Input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="Ex: 5511999999999"
                type="tel"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditContact(null)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button onClick={handleSaveEdit} disabled={isSaving}>
              {isSaving ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG DE CONFIRMAÇÃO DE EXCLUSÃO */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza absoluta?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação não pode ser desfeita. O lead será permanentemente removido da sua empresa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Excluindo..." : "Sim, excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* MODAL CONVERSA RESTRITA (BORRADA) */}
      <Dialog open={!!blurContact} onOpenChange={(open) => !open && setBlurContact(null)}>
        <DialogContent className="max-w-md p-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
              <User className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">
                {blurContact?.lead_name || blurContact?.lead_code || formatPhone(blurContact?.remote_jid ?? "")}
              </p>
              <p className="text-xs text-muted-foreground">{formatPhone(blurContact?.remote_jid ?? "")}</p>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
              <Lock className="h-3 w-3" />
              Acesso restrito
            </div>
          </div>

          {/* Mensagens borradas */}
          <div className="relative h-[420px] overflow-hidden bg-muted/20">
            {blurLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : blurMessages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <MessageCircle className="h-10 w-10 opacity-30" />
                <p className="text-sm">Nenhuma mensagem encontrada</p>
              </div>
            ) : (
              <>
                {/* Mensagens com blur */}
                <div className="flex h-full flex-col gap-2 overflow-y-auto p-4 blur-sm select-none pointer-events-none">
                  {blurMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.from_me ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                          msg.from_me
                            ? "bg-primary text-primary-foreground"
                            : "bg-background border border-border"
                        }`}
                      >
                        <p className="break-words">{msg.message || "📎 Arquivo"}</p>
                        <p className={`mt-0.5 text-right text-[10px] opacity-60`}>
                          {new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Overlay de bloqueio */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/60 backdrop-blur-[2px]">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-background shadow-lg border border-border">
                    <Lock className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="text-center px-6">
                    <p className="font-semibold text-foreground">Conversa restrita</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Este lead não está atribuído a você.<br />
                      Há {blurMessages.length} mensagem{blurMessages.length !== 1 ? "s" : ""} nesta conversa.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="border-t px-4 py-3 text-center text-xs text-muted-foreground">
            Entre em contato com um administrador para obter acesso
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}