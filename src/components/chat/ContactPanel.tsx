import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  X, User, Phone, Mail, MapPin, FileText, ShoppingCart, Wrench,
  Link2, UserPlus, Loader2, ExternalLink, Printer, Plus, Calendar,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBRL } from "@/lib/formatters";

import type { ChatConversation } from "./types";

interface Props {
  conversation: ChatConversation | null;
  onClose: () => void;
  /** Callback pra atualizar a lista de conversas (após vincular cliente) */
  onContactLinked: () => void;
}

interface CustomerInfo {
  id: string;
  name: string;
  trade_name: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  source: string | null;
}

interface OsItem {
  id: string;
  number: number;
  status: string;
  total: number | null;
  created_at: string;
  title: string | null;
}

interface SaleItem {
  id: string;
  number: number;
  status: string;
  total: number;
  created_at: string;
}

interface EquipItem {
  id: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
}

export default function ContactPanel({ conversation, onClose, onContactLinked }: Props) {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [os, setOs] = useState<OsItem[]>([]);
  const [sales, setSales] = useState<SaleItem[]>([]);
  const [equipments, setEquipments] = useState<EquipItem[]>([]);

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<CustomerInfo[]>([]);
  const [linking, setLinking] = useState(false);

  /* ─── LOAD CUSTOMER DETAILS ─── */
  async function loadCustomerDetails() {
    if (!conversation?.customer_id) {
      setCustomer(null);
      setOs([]);
      setSales([]);
      setEquipments([]);
      return;
    }
    setLoading(true);
    try {
      const { data: c } = await supabase
        .from("customers")
        .select("id, name, trade_name, document, email, phone, whatsapp, street, city, state, notes, source")
        .eq("id", conversation.customer_id)
        .maybeSingle();
      setCustomer((c as any) || null);

      const [osRes, salesRes, eqRes] = await Promise.all([
        supabase.from("service_orders" as any)
          .select("id, number, status, total, created_at, title")
          .eq("customer_id", conversation.customer_id)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase.from("sales" as any)
          .select("id, number, status, total, created_at")
          .eq("customer_id", conversation.customer_id)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase.from("customer_equipments" as any)
          .select("id, brand, model, serial")
          .eq("customer_id", conversation.customer_id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      setOs(((osRes.data as any[]) || []) as OsItem[]);
      setSales(((salesRes.data as any[]) || []) as SaleItem[]);
      setEquipments(((eqRes.data as any[]) || []) as EquipItem[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCustomerDetails(); /* eslint-disable-next-line */ }, [conversation?.customer_id]);

  /* ─── BUSCAR CLIENTES P/ VINCULAR ─── */
  useEffect(() => {
    if (!linkOpen || !companyId) return;
    const t = setTimeout(async () => {
      const q = linkSearch.trim();
      const query = supabase
        .from("customers")
        .select("id, name, trade_name, document, email, phone, whatsapp, street, city, state, notes, source")
        .eq("company_id", companyId)
        .order("name")
        .limit(20);
      if (q) {
        query.or(`name.ilike.%${q}%,trade_name.ilike.%${q}%,document.ilike.%${q}%,phone.ilike.%${q}%`);
      }
      const { data } = await query;
      setLinkResults(((data as any[]) || []) as CustomerInfo[]);
    }, 200);
    return () => clearTimeout(t);
  }, [linkOpen, linkSearch, companyId]);

  /* ─── VINCULAR ───
     Define o customer.whatsapp + customer.remote_jid pra próximas mensagens caírem como "Cliente" */
  async function handleLink(customerId: string) {
    if (!conversation) return;
    setLinking(true);
    try {
      const phone = conversation.remote_jid; // já sem @s.whatsapp.net
      const jid = `${phone}@s.whatsapp.net`;
      const { error } = await supabase
        .from("customers")
        .update({ whatsapp: phone, remote_jid: jid })
        .eq("id", customerId);
      if (error) throw error;
      toast({ title: "Vinculado", description: "Conversa associada ao cliente." });
      setLinkOpen(false);
      onContactLinked();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message, variant: "destructive" });
    } finally {
      setLinking(false);
    }
  }

  /* ─── CRIAR NOVO CLIENTE A PARTIR DO NÚMERO ─── */
  async function handleCreateCustomerFromContact() {
    if (!conversation || !companyId) return;
    const name = conversation.display_name || `Contato +${conversation.remote_jid}`;
    setLinking(true);
    try {
      const phone = conversation.remote_jid;
      const jid = `${phone}@s.whatsapp.net`;
      const { data, error } = await supabase
        .from("customers")
        .insert({
          company_id: companyId,
          name,
          phone,
          whatsapp: phone,
          remote_jid: jid,
          person_type: "PF",
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      toast({ title: "Cliente criado", description: name });
      onContactLinked();
      return data?.id;
    } catch (e: any) {
      toast({ title: "Erro ao criar cliente", description: e?.message, variant: "destructive" });
    } finally {
      setLinking(false);
    }
  }

  if (!conversation) return null;

  return (
    <aside className="h-full w-[320px] border-l border-border/50 bg-card/40 flex flex-col">
      {/* HEADER */}
      <div className="p-3 border-b border-border/50 flex items-center justify-between">
        <h3 className="font-semibold text-sm">Informações do contato</h3>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* AVATAR + NOME */}
          <div className="flex flex-col items-center text-center pb-3 border-b border-border/30">
            <div className={`h-20 w-20 rounded-full flex items-center justify-center ring-2 mb-2 ${
              conversation.customer_id
                ? "bg-emerald-500/15 ring-emerald-500/40 text-emerald-300"
                : "bg-white/10 ring-white/20 text-muted-foreground"
            }`}>
              <span className="font-bold text-2xl">
                {(conversation.display_name?.[0] || conversation.remote_jid?.[0] || "?").toUpperCase()}
              </span>
            </div>
            <h4 className="font-semibold">{conversation.display_name || `+${conversation.remote_jid}`}</h4>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">+{conversation.remote_jid}</p>
            {!conversation.customer_id && (
              <Badge variant="outline" className="mt-2 text-[10px]">Contato não cadastrado</Badge>
            )}
          </div>

          {/* AÇÕES */}
          <div className="space-y-2">
            {!conversation.customer_id ? (
              <>
                <Button className="w-full justify-start" size="sm" onClick={() => setLinkOpen(true)}>
                  <Link2 className="h-4 w-4 mr-2" /> Vincular a cliente existente
                </Button>
                <Button
                  className="w-full justify-start"
                  size="sm"
                  variant="outline"
                  onClick={handleCreateCustomerFromContact}
                  disabled={linking}
                >
                  {linking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
                  Cadastrar como novo cliente
                </Button>
              </>
            ) : (
              <Button asChild className="w-full justify-start" size="sm" variant="outline">
                <Link to={`/customers/${conversation.customer_id}`}>
                  <ExternalLink className="h-4 w-4 mr-2" /> Abrir ficha completa
                </Link>
              </Button>
            )}

            {conversation.customer_id && (
              <>
                <Button asChild className="w-full justify-start" size="sm">
                  <Link to={`/service-orders/new?customer_id=${conversation.customer_id}`}>
                    <Wrench className="h-4 w-4 mr-2" /> Criar OS desta conversa
                  </Link>
                </Button>
                <Button asChild className="w-full justify-start" size="sm" variant="outline">
                  <Link to={`/sales/new?customer_id=${conversation.customer_id}`}>
                    <ShoppingCart className="h-4 w-4 mr-2" /> Criar venda
                  </Link>
                </Button>
              </>
            )}
          </div>

          {/* DETALHES CLIENTE */}
          {loading && (
            <div className="text-center py-4 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline" /> Carregando...
            </div>
          )}

          {!loading && customer && (
            <>
              <div className="space-y-2 pt-2 border-t border-border/30">
                <h5 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Contato</h5>
                {customer.email && (
                  <Row icon={Mail} label="Email" value={customer.email} />
                )}
                {customer.phone && (
                  <Row icon={Phone} label="Telefone" value={customer.phone} />
                )}
                {customer.document && (
                  <Row icon={FileText} label="CPF/CNPJ" value={customer.document} />
                )}
                {(customer.city || customer.state) && (
                  <Row icon={MapPin} label="Cidade" value={[customer.street, customer.city, customer.state].filter(Boolean).join(" · ")} />
                )}
                {customer.source && (
                  <Row icon={User} label="Origem" value={customer.source} />
                )}
              </div>

              {/* OS */}
              {os.length > 0 && (
                <div className="space-y-2 pt-3 border-t border-border/30">
                  <div className="flex items-center justify-between">
                    <h5 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Ordens de Serviço ({os.length})
                    </h5>
                  </div>
                  {os.slice(0, 5).map((o) => (
                    <Link
                      key={o.id}
                      to={`/service-orders/${o.id}`}
                      className="block rounded border border-border/30 px-2 py-1.5 text-xs hover:bg-white/5 transition"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono">#{String(o.number).padStart(6, "0")}</span>
                        <Badge variant="outline" className="text-[9px] h-4">{o.status}</Badge>
                      </div>
                      {o.title && <div className="text-muted-foreground truncate mt-0.5">{o.title}</div>}
                      <div className="text-muted-foreground/70 text-[10px] flex items-center justify-between mt-0.5">
                        <span>{new Date(o.created_at).toLocaleDateString("pt-BR")}</span>
                        {o.total != null && <span>{formatBRL(o.total)}</span>}
                      </div>
                    </Link>
                  ))}
                  {os.length > 5 && (
                    <Link to={`/service-orders?customer_id=${conversation.customer_id}`} className="text-xs text-blue-400 hover:underline block text-center">
                      Ver todas →
                    </Link>
                  )}
                </div>
              )}

              {/* VENDAS */}
              {sales.length > 0 && (
                <div className="space-y-2 pt-3 border-t border-border/30">
                  <h5 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Vendas ({sales.length})
                  </h5>
                  {sales.slice(0, 5).map((s) => (
                    <Link
                      key={s.id}
                      to={`/sales/${s.id}`}
                      className="block rounded border border-border/30 px-2 py-1.5 text-xs hover:bg-white/5 transition"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono">#{String(s.number).padStart(6, "0")}</span>
                        <Badge variant="outline" className="text-[9px] h-4">{s.status}</Badge>
                      </div>
                      <div className="text-muted-foreground/70 text-[10px] flex items-center justify-between mt-0.5">
                        <span>{new Date(s.created_at).toLocaleDateString("pt-BR")}</span>
                        <span>{formatBRL(s.total)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {/* EQUIPAMENTOS */}
              {equipments.length > 0 && (
                <div className="space-y-2 pt-3 border-t border-border/30">
                  <h5 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Equipamentos ({equipments.length})
                  </h5>
                  {equipments.slice(0, 5).map((e) => (
                    <div key={e.id} className="text-xs rounded border border-border/30 px-2 py-1.5">
                      <div className="font-medium">{[e.brand, e.model].filter(Boolean).join(" ") || "(sem dados)"}</div>
                      {e.serial && <div className="text-muted-foreground font-mono text-[10px] mt-0.5">SN: {e.serial}</div>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {!loading && !customer && conversation.customer_id && (
            <div className="text-xs text-muted-foreground text-center py-4">
              Cliente não encontrado.
            </div>
          )}
        </div>
      </ScrollArea>

      {/* MODAL VINCULAR CLIENTE */}
      {linkOpen && (
        <div className="absolute inset-0 z-30 bg-black/60 flex items-end" onClick={() => setLinkOpen(false)}>
          <div
            className="bg-card border-t border-border w-full max-h-[70%] rounded-t-lg flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 border-b border-border/50 flex items-center justify-between">
              <h4 className="font-semibold text-sm">Vincular a cliente</h4>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setLinkOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-3">
              <input
                autoFocus
                placeholder="Buscar por nome, CPF/CNPJ, telefone..."
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm"
              />
            </div>
            <ScrollArea className="flex-1">
              <div className="px-3 pb-3 space-y-1">
                {linkResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleLink(c.id)}
                    disabled={linking}
                    className="w-full text-left rounded border border-border/30 px-3 py-2 hover:bg-white/5 transition disabled:opacity-50"
                  >
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {[c.document, c.phone, c.email].filter(Boolean).join(" · ") || "(sem detalhes)"}
                    </div>
                  </button>
                ))}
                {linkResults.length === 0 && (
                  <div className="text-center text-xs text-muted-foreground py-6">
                    Nenhum cliente encontrado.
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </aside>
  );
}

function Row({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-muted-foreground text-[10px]">{label}</div>
        <div className="truncate">{value}</div>
      </div>
    </div>
  );
}
