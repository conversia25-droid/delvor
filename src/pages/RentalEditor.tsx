import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  Loader2,
  Plus,
  Trash2,
  Repeat,
  Gauge,
  FileText,
  Receipt,
  Boxes,
  Wrench,
  AlertTriangle,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

import type {
  Customer,
  CustomerEquipment,
  RentalContract,
  RentalContractItem,
  RentalInvoice,
  RentalMeterReading,
  RentalStatus,
} from "@/types/delvor";
import { RENTAL_STATUS_LABELS, RENTAL_INVOICE_STATUS_LABELS } from "@/types/delvor";

import { formatBRL, formatDateBR } from "@/lib/formatters";
import CustomerCombobox from "@/components/sales/CustomerCombobox";
import AddRentalEquipmentDialog from "@/components/rentals/AddRentalEquipmentDialog";
import RegisterReadingDialog from "@/components/rentals/RegisterReadingDialog";
import GenerateInvoiceDialog from "@/components/rentals/GenerateInvoiceDialog";
import { usePermissions } from "@/hooks/usePermissions";

type ContractItemRow = RentalContractItem & {
  equipment?: CustomerEquipment | null;
  lastReading?: RentalMeterReading | null;
};

export default function RentalEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const perms = usePermissions();
  const isNew = !id || id === "new";

  // Carrega equipe pra mostrar nome do técnico responsável de cada item
  const [team, setTeam] = useState<{ id: string; nome: string }[]>([]);
  useEffect(() => {
    if (!user?.company_id) return;
    supabase.from("profiles" as any).select("id, nome").eq("company_id", user.company_id).order("nome")
      .then(({ data }) => setTeam(((data as any[]) ?? []) as any));
  }, [user?.company_id]);

  // Header
  const [contract, setContract] = useState<RentalContract | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [status, setStatus] = useState<RentalStatus>("ativo");
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState<string>("");
  const [billingDay, setBillingDay] = useState<string>("5");
  const [notes, setNotes] = useState("");

  const [items, setItems] = useState<ContractItemRow[]>([]);
  const [invoices, setInvoices] = useState<RentalInvoice[]>([]);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  const [addEquipOpen, setAddEquipOpen] = useState(false);
  const [readingFor, setReadingFor] = useState<ContractItemRow | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<ContractItemRow | null>(null);

  /* ====================== LOAD ====================== */
  async function load() {
    if (isNew || !id) return;
    setLoading(true);
    const [cr, ir, inv] = await Promise.all([
      supabase.from("rental_contracts" as any).select("*").eq("id", id).maybeSingle(),
      supabase
        .from("rental_contract_items" as any)
        .select("*, customer_equipments ( id, brand, model, serial_number, current_counter_bw, current_counter_color, last_counter_at )")
        .eq("contract_id", id),
      supabase.from("rental_invoices" as any).select("*").eq("contract_id", id).order("reference_month", { ascending: false }),
    ]);
    if (cr.error || !cr.data) {
      toast({ title: "Contrato não encontrado", variant: "destructive" });
      navigate("/rentals");
      return;
    }
    const c = cr.data as RentalContract;
    setContract(c);
    setCustomerId(c.customer_id);
    setStatus(c.status);
    setStartDate(c.start_date);
    setEndDate(c.end_date || "");
    setBillingDay(String(c.billing_day));
    setNotes(c.notes || "");

    const itemRows = ((ir.data as any[]) ?? []).map((it) => ({
      ...it,
      equipment: it.customer_equipments,
    })) as ContractItemRow[];

    // Carrega última leitura por item (em paralelo)
    const itemIds = itemRows.map((it) => it.id);
    if (itemIds.length) {
      const { data: readings } = await supabase
        .from("rental_meter_readings" as any)
        .select("*")
        .in("contract_item_id", itemIds)
        .order("reading_date", { ascending: false })
        .order("created_at", { ascending: false });
      const lastByItem = new Map<string, RentalMeterReading>();
      ((readings as any[]) ?? []).forEach((r) => {
        if (!lastByItem.has(r.contract_item_id)) lastByItem.set(r.contract_item_id, r);
      });
      itemRows.forEach((it) => { it.lastReading = lastByItem.get(it.id) || null; });
    }
    setItems(itemRows);
    setInvoices(((inv.data as any[]) ?? []) as RentalInvoice[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  // Cliente atual
  useEffect(() => {
    if (!customerId) { setCustomer(null); return; }
    if (customer?.id === customerId) return;
    supabase.from("customers" as any).select("*").eq("id", customerId).maybeSingle()
      .then(({ data }) => setCustomer((data as any) || null));
  }, [customerId]);

  /* ====================== TOTAIS ====================== */
  const monthlyBaseTotal = useMemo(
    () => items.reduce((s, it) => s + Number(it.monthly_value || 0), 0),
    [items]
  );

  /* ====================== SAVE ====================== */
  async function save() {
    if (!user?.company_id) return;
    if (!customerId) {
      toast({ title: "Selecione um cliente", variant: "destructive" });
      return;
    }
    if (!startDate) {
      toast({ title: "Informe a data de início", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload: any = {
      company_id: user.company_id,
      customer_id: customerId,
      status,
      start_date: startDate,
      end_date: endDate || null,
      billing_day: parseInt(billingDay, 10) || 1,
      notes: notes.trim() || null,
    };
    let cid = contract?.id;
    if (isNew && !cid) {
      const { data, error } = await supabase.from("rental_contracts" as any).insert(payload).select().single();
      setSaving(false);
      if (error || !data) {
        toast({ title: "Erro ao salvar", description: error?.message, variant: "destructive" });
        return;
      }
      navigate(`/rentals/${(data as any).id}`, { replace: true });
      return;
    }
    const { error } = await supabase.from("rental_contracts" as any).update(payload).eq("id", cid!);
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Contrato salvo" });
    load();
  }

  async function removeItem(it: ContractItemRow) {
    const { error } = await supabase.from("rental_contract_items" as any).delete().eq("id", it.id);
    if (error) {
      toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Equipamento removido do contrato" });
    setConfirmRemove(null);
    load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando contrato...
      </div>
    );
  }

  const statusBadge = RENTAL_STATUS_LABELS[status];

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/rentals"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Repeat className="h-6 w-6" />
              {isNew && !contract ? "Novo contrato" : `Contrato #${String(contract?.number ?? "—").padStart(6, "0")}`}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge className={`${statusBadge.tone} ring-1`}>{statusBadge.label}</Badge>
              {customer && (
                <span className="text-xs text-muted-foreground">
                  Cliente: <span className="text-foreground">{customer.name}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar
          </Button>
          {!isNew && status === "ativo" && perms.canGenerateRentalInvoice && (
            <Button onClick={() => setGenerateOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <FileText className="h-4 w-4 mr-1" /> Gerar fatura mensal
            </Button>
          )}
        </div>
      </div>

      {/* HEADER FORM */}
      <div className="rounded-lg border bg-card p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="lg:col-span-2">
          <Label>Cliente *</Label>
          <CustomerCombobox value={customerId} onChange={setCustomerId} includeInternal={perms.canManageInternalCustomers} />
        </div>
        <div>
          <Label>Status</Label>
          <Select value={status} onValueChange={(v: RentalStatus) => setStatus(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(RENTAL_STATUS_LABELS) as RentalStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{RENTAL_STATUS_LABELS[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Início</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <Label>Fim (opcional)</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div>
          <Label>Dia de cobrança</Label>
          <Input
            type="number" min={1} max={28}
            value={billingDay}
            onChange={(e) => setBillingDay(e.target.value)}
          />
        </div>
        <div className="lg:col-span-4">
          <Label>Observações do contrato</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {isNew && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          Salve o contrato primeiro pra adicionar equipamentos, registrar leituras e gerar faturas.
        </div>
      )}

      {/* TABS — Equipamentos / Faturas */}
      {!isNew && contract && (
        <Tabs defaultValue="equipamentos">
          <TabsList>
            <TabsTrigger value="equipamentos">
              <Boxes className="h-3.5 w-3.5 mr-1" /> Equipamentos ({items.length})
            </TabsTrigger>
            <TabsTrigger value="faturas">
              <Receipt className="h-3.5 w-3.5 mr-1" /> Faturas ({invoices.length})
            </TabsTrigger>
          </TabsList>

          {/* ============== EQUIPAMENTOS ============== */}
          <TabsContent value="equipamentos" className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                Mensalidade base do contrato: <span className="font-mono font-semibold text-foreground">{formatBRL(monthlyBaseTotal)}</span>
                <span className="text-xs text-muted-foreground ml-2">(soma fixa, antes de excedentes)</span>
              </div>
              {customerId && (
                <Button onClick={() => setAddEquipOpen(true)} size="sm">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar equipamento
                </Button>
              )}
            </div>

            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipamento</TableHead>
                    <TableHead className="w-40">Técnico</TableHead>
                    <TableHead className="w-32 text-right">Mensalidade</TableHead>
                    <TableHead className="w-44">Franquia</TableHead>
                    <TableHead>Última leitura</TableHead>
                    <TableHead className="w-44 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                      Nenhum equipamento. Adicione pelo menos um.
                    </TableCell></TableRow>
                  )}
                  {items.map((it) => {
                    const eq = it.equipment;
                    const r = it.lastReading;
                    const techName = team.find((t) => t.id === it.technician_id)?.nome;
                    const isMyItem = !!user && it.technician_id === user.id;
                    return (
                      <TableRow key={it.id} className={isMyItem ? "bg-emerald-500/5" : ""}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {[eq?.brand, eq?.model].filter(Boolean).join(" ") || "Equipamento"}
                            </span>
                            {eq?.serial_number && (
                              <span className="text-xs text-muted-foreground font-mono">SN {eq.serial_number}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {techName ? (
                            <span className={isMyItem ? "text-emerald-700 dark:text-emerald-400 font-medium" : ""}>
                              {techName}{isMyItem && " (você)"}
                            </span>
                          ) : <span className="text-muted-foreground">não atribuído</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatBRL(it.monthly_value)}</TableCell>
                        <TableCell className="text-xs">
                          {it.franchise_bw == null && it.franchise_color == null ? (
                            <span className="text-muted-foreground">— (sem franquia)</span>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              {it.franchise_bw != null && (
                                <span>
                                  P&B: {it.franchise_bw} págs · {formatBRL(Number(it.overage_bw_unit_price || 0))}/excedente
                                </span>
                              )}
                              {it.franchise_color != null && (
                                <span>
                                  Color: {it.franchise_color} págs · {formatBRL(Number(it.overage_color_unit_price || 0))}/excedente
                                </span>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-muted-foreground">{new Date(r.reading_date).toLocaleDateString("pt-BR")}</span>
                              <span className="font-mono">
                                {r.counter_bw != null && <>P&B {r.counter_bw}</>}
                                {r.counter_bw != null && r.counter_color != null && " · "}
                                {r.counter_color != null && <>Color {r.counter_color}</>}
                              </span>
                            </div>
                          ) : <span className="text-muted-foreground">sem leituras</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setReadingFor(it)}
                              title="Registrar leitura"
                            >
                              <Gauge className="h-3.5 w-3.5 mr-1 text-emerald-500" /> Leitura
                            </Button>
                            {eq && (
                              <Button variant="ghost" size="icon" asChild title="Abrir OS">
                                <Link to={`/service-orders/new?customer=${customerId}&equipment=${eq.id}`}>
                                  <Wrench className="h-4 w-4" />
                                </Link>
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => setConfirmRemove(it)} title="Remover">
                              <Trash2 className="h-4 w-4 text-rose-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ============== FATURAS ============== */}
          <TabsContent value="faturas" className="mt-4">
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Número</TableHead>
                    <TableHead>Mês de referência</TableHead>
                    <TableHead className="w-32">Vencimento</TableHead>
                    <TableHead className="w-32">Status</TableHead>
                    <TableHead className="w-32 text-right">Base</TableHead>
                    <TableHead className="w-32 text-right">Excedente</TableHead>
                    <TableHead className="w-32 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      Nenhuma fatura gerada ainda. Use "Gerar fatura mensal" no topo.
                    </TableCell></TableRow>
                  )}
                  {invoices.map((inv) => {
                    const meta = RENTAL_INVOICE_STATUS_LABELS[inv.status];
                    const refLabel = new Date(inv.reference_month + "T00:00:00")
                      .toLocaleString("pt-BR", { month: "long", year: "numeric" });
                    return (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono">#{String(inv.number).padStart(4, "0")}</TableCell>
                        <TableCell className="capitalize">{refLabel}</TableCell>
                        <TableCell className="text-xs">{formatDateBR(inv.due_date)}</TableCell>
                        <TableCell><Badge className={`${meta.tone} ring-1`}>{meta.label}</Badge></TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatBRL(inv.base_total)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatBRL(inv.overage_total)}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{formatBRL(inv.total)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* DIALOGS */}
      {!isNew && contract && customerId && (
        <AddRentalEquipmentDialog
          open={addEquipOpen}
          onOpenChange={setAddEquipOpen}
          contractId={contract.id}
          customerId={customerId}
          onAdded={load}
        />
      )}

      {readingFor && (
        <RegisterReadingDialog
          open={!!readingFor}
          onOpenChange={(o) => !o && setReadingFor(null)}
          contractItem={readingFor}
          equipment={readingFor.equipment || null}
          onSaved={load}
        />
      )}

      {!isNew && contract && (
        <GenerateInvoiceDialog
          open={generateOpen}
          onOpenChange={setGenerateOpen}
          contractId={contract.id}
          onGenerated={load}
        />
      )}

      <AlertDialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover equipamento do contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              O equipamento sai deste contrato (não é apagado do cadastro).
              Faturas já geradas continuam intactas. Leituras são apagadas junto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={() => confirmRemove && removeItem(confirmRemove)}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
