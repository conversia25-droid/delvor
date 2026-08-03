import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  User as UserIcon,
  MessageSquare,
  Wrench,
  ShoppingCart,
  Boxes,
  Plus,
  FileText,
  Loader2,
  Pencil,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type {
  Customer,
  CustomerEquipment,
  Sale,
  ServiceOrder,
} from "@/types/delvor";
import { OS_STATUS_LABELS, SALE_STATUS_LABELS } from "@/types/delvor";
import {
  formatBRL,
  formatCep,
  formatDateBR,
  formatDocument,
  formatPhone,
} from "@/lib/formatters";
import EquipmentFormDialog from "@/components/service-orders/EquipmentFormDialog";

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [equipments, setEquipments] = useState<CustomerEquipment[]>([]);
  const [serviceOrders, setServiceOrders] = useState<ServiceOrder[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [equipmentDialog, setEquipmentDialog] = useState<{ open: boolean; eq: CustomerEquipment | null }>({ open: false, eq: null });

  async function load() {
    if (!id) return;
    setLoading(true);
    const [cr, er, sr, sar] = await Promise.all([
      supabase.from("customers" as any).select("*").eq("id", id).maybeSingle(),
      supabase.from("customer_equipments" as any).select("*").eq("customer_id", id).order("brand"),
      supabase.from("service_orders" as any).select("*").eq("customer_id", id).order("created_at", { ascending: false }).limit(50),
      supabase.from("sales" as any).select("*").eq("customer_id", id).order("created_at", { ascending: false }).limit(50),
    ]);
    setLoading(false);
    if (cr.error || !cr.data) {
      toast({ title: "Cliente não encontrado", variant: "destructive" });
      navigate("/customers");
      return;
    }
    setCustomer(cr.data as any);
    setEquipments(((er.data as any[]) ?? []) as any);
    setServiceOrders(((sr.data as any[]) ?? []) as any);
    setSales(((sar.data as any[]) ?? []) as any);
  }

  useEffect(() => { load(); }, [id]);

  if (loading || !customer) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando cliente...
      </div>
    );
  }

  const fullAddr = [
    customer.street && customer.number ? `${customer.street}, ${customer.number}` : customer.street,
    customer.complement,
    customer.district,
    customer.city && customer.state ? `${customer.city}/${customer.state}` : customer.city,
    customer.zipcode ? `CEP ${formatCep(customer.zipcode)}` : null,
  ].filter(Boolean).join(" — ");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/customers"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {customer.person_type === "PJ"
                ? <Building2 className="h-6 w-6 text-muted-foreground" />
                : <UserIcon className="h-6 w-6 text-muted-foreground" />}
              {customer.name}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap text-sm text-muted-foreground">
              {customer.trade_name && <span>{customer.trade_name}</span>}
              {customer.document && <span className="font-mono">{formatDocument(customer.document)}</span>}
              {customer.blocked && <Badge variant="destructive">Bloqueado</Badge>}
              {!customer.active && <Badge variant="secondary">Inativo</Badge>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {customer.remote_jid && (
            <Button variant="outline" asChild>
              <Link to={`/chat?jid=${encodeURIComponent(customer.remote_jid)}`}>
                <MessageSquare className="h-4 w-4 mr-1 text-emerald-500" /> WhatsApp
              </Link>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to={`/customers?edit=${customer.id}`}>
              <Pencil className="h-4 w-4 mr-1" /> Editar
            </Link>
          </Button>
          <Button onClick={() => navigate(`/service-orders/new?customer=${customer.id}`)}>
            <Wrench className="h-4 w-4 mr-1" /> Nova OS
          </Button>
          <Button onClick={() => navigate(`/sales/new?customer=${customer.id}`)} variant="outline">
            <ShoppingCart className="h-4 w-4 mr-1" /> Nova Venda
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="dados">
        <TabsList>
          <TabsTrigger value="dados"><FileText className="h-3 w-3 mr-1" /> Dados</TabsTrigger>
          <TabsTrigger value="equipamentos"><Boxes className="h-3 w-3 mr-1" /> Equipamentos ({equipments.length})</TabsTrigger>
          <TabsTrigger value="os"><Wrench className="h-3 w-3 mr-1" /> OS ({serviceOrders.length})</TabsTrigger>
          <TabsTrigger value="vendas"><ShoppingCart className="h-3 w-3 mr-1" /> Vendas ({sales.length})</TabsTrigger>
        </TabsList>

        {/* Dados */}
        <TabsContent value="dados" className="mt-4">
          <div className="rounded-lg border bg-card p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <div className="text-xs text-muted-foreground mb-1">E-mail</div>
              <div>{customer.email || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Telefone</div>
              <div className="font-mono">{customer.phone ? formatPhone(customer.phone) : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">WhatsApp</div>
              <div className="font-mono">{customer.whatsapp ? formatPhone(customer.whatsapp) : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Origem</div>
              <div>{customer.source || "—"}</div>
            </div>
            <div className="md:col-span-2">
              <div className="text-xs text-muted-foreground mb-1">Endereço</div>
              <div>{fullAddr || "—"}</div>
            </div>
            {customer.notes && (
              <div className="md:col-span-2">
                <div className="text-xs text-muted-foreground mb-1">Observações</div>
                <div className="text-sm whitespace-pre-wrap">{customer.notes}</div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Equipamentos */}
        <TabsContent value="equipamentos" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button onClick={() => setEquipmentDialog({ open: true, eq: null })}>
              <Plus className="h-4 w-4 mr-1" /> Novo equipamento
            </Button>
          </div>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Marca/Modelo</TableHead>
                  <TableHead>Série</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {equipments.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Nenhum equipamento cadastrado.</TableCell></TableRow>
                )}
                {equipments.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{[e.brand, e.model].filter(Boolean).join(" ") || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{e.serial_number || "—"}</TableCell>
                    <TableCell className="text-sm">{e.category || "—"}</TableCell>
                    <TableCell className="text-sm">{e.location || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{e.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEquipmentDialog({ open: true, eq: e })}>
                        <Pencil className="h-3 w-3 mr-1" /> Editar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/service-orders/new?customer=${customer.id}&equipment=${e.id}`)}>
                        <Wrench className="h-3 w-3 mr-1" /> Abrir OS
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* OS */}
        <TabsContent value="os" className="mt-4">
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Número</TableHead>
                  <TableHead>Defeito</TableHead>
                  <TableHead className="w-36">Status</TableHead>
                  <TableHead className="w-32">Aberta em</TableHead>
                  <TableHead className="w-28 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serviceOrders.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Nenhuma OS para este cliente.</TableCell></TableRow>
                )}
                {serviceOrders.map((o) => {
                  const meta = OS_STATUS_LABELS[o.status];
                  return (
                    <TableRow key={o.id} className="cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/service-orders/${o.id}`)}>
                      <TableCell className="font-mono">#{String(o.number).padStart(6, "0")}</TableCell>
                      <TableCell className="text-sm line-clamp-2">{o.reported_issue || "—"}</TableCell>
                      <TableCell><Badge className={`${meta.tone} ring-1`}>{meta.label}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell className="text-right font-mono">{formatBRL(o.total)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Vendas */}
        <TabsContent value="vendas" className="mt-4">
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Número</TableHead>
                  <TableHead className="w-36">Status</TableHead>
                  <TableHead className="w-32">Emissão</TableHead>
                  <TableHead className="w-28 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">Nenhuma venda.</TableCell></TableRow>
                )}
                {sales.map((s) => {
                  const meta = SALE_STATUS_LABELS[s.status];
                  return (
                    <TableRow key={s.id} className="cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/sales/${s.id}`)}>
                      <TableCell className="font-mono">#{String(s.number).padStart(6, "0")}</TableCell>
                      <TableCell><Badge className={`${meta.tone} ring-1`}>{meta.label}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateBR(s.issue_date)}</TableCell>
                      <TableCell className="text-right font-mono">{formatBRL(s.total)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <EquipmentFormDialog
        open={equipmentDialog.open}
        onOpenChange={(o) => setEquipmentDialog((s) => ({ ...s, open: o }))}
        customerId={customer.id}
        equipment={equipmentDialog.eq}
        onSaved={() => { setEquipmentDialog({ open: false, eq: null }); load(); }}
      />
    </div>
  );
}
