import { useEffect, useRef, useState } from "react";
import {
  Upload, FileText, Loader2, CheckCircle2, AlertTriangle,
  Plus, Search, Truck, Package,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { parseNfeXml, type NfeData, type NfeItem } from "@/lib/parseNfeXml";
import { formatBRL, formatDocument } from "@/lib/formatters";
import type { Product, Supplier } from "@/types/delvor";
import QuickProductDialog from "@/components/products/QuickProductDialog";
import QuickSupplierDialog from "./QuickSupplierDialog";

interface NfeImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado depois de criar a Purchase, com o id pra navegar. */
  onImported?: (purchaseId: string) => void;
}

type ItemMatch = {
  nfeItem: NfeItem;
  /** Produto existente que casou com o item da NF (null = não achou) */
  product: Product | null;
  /** Estado da resolução do item */
  resolved: boolean;
};

export default function NfeImportDialog({ open, onOpenChange, onImported }: NfeImportDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"upload" | "review">("upload");
  const [parsing, setParsing] = useState(false);
  const [nfe, setNfe] = useState<NfeData | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [matches, setMatches] = useState<ItemMatch[]>([]);
  const [importing, setImporting] = useState(false);

  // Sub-dialogs (para criar fornecedor / produto não encontrado)
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);
  const [createProductIdx, setCreateProductIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      // reset ao fechar
      setStep("upload");
      setParsing(false);
      setNfe(null);
      setSupplier(null);
      setMatches([]);
      setImporting(false);
    }
  }, [open]);

  /* ============================================================
     STEP 1 — Upload + parse + auto-match
  ============================================================ */
  async function handleFile(file: File) {
    if (!user?.company_id) return;
    setParsing(true);
    try {
      const xml = await file.text();
      const data = parseNfeXml(xml);
      setNfe(data);

      // Auto-match fornecedor por CNPJ
      let foundSupplier: Supplier | null = null;
      if (data.emitente.cnpj) {
        const { data: s } = await supabase
          .from("suppliers" as any)
          .select("*")
          .eq("company_id", user.company_id)
          .eq("document", data.emitente.cnpj)
          .maybeSingle();
        foundSupplier = (s as any) || null;
      }
      setSupplier(foundSupplier);

      // Auto-match de produtos: por código de barras > SKU > nome ilike
      const matched: ItemMatch[] = [];
      for (const item of data.itens) {
        let product: Product | null = null;

        if (item.cEAN) {
          const { data: p } = await supabase
            .from("products" as any)
            .select("*")
            .eq("company_id", user.company_id)
            .is("hidden_at", null)
            .eq("barcode", item.cEAN)
            .maybeSingle();
          if (p) product = p as any;
        }
        if (!product && item.cProd) {
          const { data: p } = await supabase
            .from("products" as any)
            .select("*")
            .eq("company_id", user.company_id)
            .is("hidden_at", null)
            .eq("sku", item.cProd)
            .maybeSingle();
          if (p) product = p as any;
        }
        if (!product) {
          // Match aproximado por nome (ilike)
          const { data: ps } = await supabase
            .from("products" as any)
            .select("*")
            .eq("company_id", user.company_id)
            .is("hidden_at", null)
            .ilike("name", `%${item.xProd.slice(0, 30)}%`)
            .limit(1);
          if (ps && (ps as any[]).length > 0) product = (ps as any[])[0];
        }

        matched.push({
          nfeItem: item,
          product,
          resolved: !!product,
        });
      }
      setMatches(matched);
      setStep("review");
    } catch (err: any) {
      toast({
        title: "Erro ao ler XML",
        description: err.message || "Verifique se o arquivo é uma NF-e válida.",
        variant: "destructive",
      });
    } finally {
      setParsing(false);
    }
  }

  /* ============================================================
     Vincula produto manualmente (busca server-side simples)
  ============================================================ */
  async function searchAndAttach(idx: number, query: string) {
    if (!user?.company_id || !query.trim()) return;
    const { data } = await supabase
      .from("products" as any)
      .select("*")
      .eq("company_id", user.company_id)
      .is("hidden_at", null)
      .or(`name.ilike.%${query}%,sku.ilike.%${query}%,barcode.eq.${query}`)
      .limit(5);
    const list = (data as any[]) ?? [];
    if (list.length === 0) {
      toast({ title: "Nenhum produto encontrado" });
      return;
    }
    setMatches((arr) => arr.map((m, i) => i === idx ? { ...m, product: list[0], resolved: true } : m));
  }

  /* ============================================================
     STEP 3 — Importar (cria purchase + items)
  ============================================================ */
  async function importPurchase() {
    if (!user?.company_id || !nfe) return;
    if (!supplier) {
      toast({ title: "Defina o fornecedor primeiro", variant: "destructive" });
      return;
    }
    const unresolved = matches.filter((m) => !m.product);
    if (unresolved.length > 0) {
      toast({
        title: `${unresolved.length} produto(s) sem cadastro`,
        description: "Cadastre todos antes de importar.",
        variant: "destructive",
      });
      return;
    }

    setImporting(true);

    // 1) Cria a purchase header
    const { data: purchase, error: pErr } = await supabase
      .from("purchases" as any)
      .insert({
        company_id: user.company_id,
        supplier_id: supplier.id,
        status: "pedido",
        issue_date: nfe.dhEmi ? nfe.dhEmi.slice(0, 10) : new Date().toISOString().slice(0, 10),
        invoice_key: nfe.chave,
        notes: `NF-e ${nfe.nNF} série ${nfe.serie} importada do XML`,
        user_id: user.id,
      })
      .select()
      .single();

    if (pErr || !purchase) {
      setImporting(false);
      toast({ title: "Erro ao criar compra", description: pErr?.message, variant: "destructive" });
      return;
    }

    // 2) Cria purchase_items
    const itemPayloads = matches.map((m) => ({
      purchase_id: (purchase as any).id,
      product_id: m.product!.id,
      qty: m.nfeItem.qCom,
      unit_cost: m.nfeItem.vUnCom,
    }));

    const { error: iErr } = await supabase.from("purchase_items" as any).insert(itemPayloads);

    setImporting(false);
    if (iErr) {
      toast({ title: "Erro ao adicionar itens", description: iErr.message, variant: "destructive" });
      return;
    }

    toast({
      title: "NF-e importada",
      description: `Compra criada com ${matches.length} item(s). Marque como recebida pra dar entrada no estoque.`,
    });
    onOpenChange(false);
    if (onImported) onImported((purchase as any).id);
    else navigate(`/purchases/${(purchase as any).id}`);
  }

  /* ============================================================
     RENDER
  ============================================================ */
  const allResolved = matches.length > 0 && matches.every((m) => !!m.product) && !!supplier;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" /> Importar NF-e (XML)
            </DialogTitle>
            <DialogDescription>
              {step === "upload"
                ? "Faça upload do arquivo XML que o fornecedor enviou. O sistema vai extrair os produtos e propor a entrada."
                : "Confira os dados, resolva produtos não encontrados e clique em Importar."}
            </DialogDescription>
          </DialogHeader>

          {/* ============== UPLOAD ============== */}
          {step === "upload" && (
            <div className="py-8">
              <input
                ref={fileRef}
                type="file"
                accept=".xml,text/xml,application/xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={parsing}
                className="w-full rounded-lg border-2 border-dashed border-border hover:border-blue-500/50 hover:bg-muted/30 transition py-12 flex flex-col items-center gap-3 disabled:opacity-50"
              >
                {parsing ? (
                  <>
                    <Loader2 className="h-12 w-12 text-blue-500 animate-spin" />
                    <span className="text-sm text-muted-foreground">Lendo XML...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-12 w-12 text-blue-500" />
                    <span className="text-base font-medium">Clique pra escolher o XML da NF-e</span>
                    <span className="text-xs text-muted-foreground">
                      Ou arraste e solte o arquivo aqui
                    </span>
                  </>
                )}
              </button>
              <div className="mt-4 text-xs text-muted-foreground space-y-1">
                <p>📌 Aceita XML autorizado pela SEFAZ (modelo 55, v4.00).</p>
                <p>🔒 Arquivo é processado localmente — não sai do seu navegador.</p>
              </div>
            </div>
          )}

          {/* ============== REVIEW ============== */}
          {step === "review" && nfe && (
            <div className="space-y-4">
              {/* Cabeçalho da NF */}
              <div className="rounded-lg border bg-muted/20 p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">NF-e</div>
                  <div className="font-mono font-medium">
                    Nº {nfe.nNF} · Série {nfe.serie}
                  </div>
                  {nfe.chave && (
                    <div className="text-[10px] text-muted-foreground font-mono break-all mt-0.5">
                      {nfe.chave}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Emissão</div>
                  <div>{nfe.dhEmi ? new Date(nfe.dhEmi).toLocaleString("pt-BR") : "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Total da NF</div>
                  <div className="font-mono font-semibold">{formatBRL(nfe.vNF)}</div>
                </div>
              </div>

              {/* Fornecedor */}
              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <Truck className="h-5 w-5 text-blue-700 dark:text-blue-400" />
                    <div>
                      <div className="text-xs text-muted-foreground">Fornecedor</div>
                      <div className="font-medium">{nfe.emitente.razao_social}</div>
                      <div className="text-xs font-mono text-muted-foreground">
                        CNPJ {formatDocument(nfe.emitente.cnpj)}
                      </div>
                    </div>
                  </div>
                  {supplier ? (
                    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Cadastrado
                    </Badge>
                  ) : (
                    <Button size="sm" onClick={() => setCreateSupplierOpen(true)}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Cadastrar fornecedor
                    </Button>
                  )}
                </div>
              </div>

              {/* Itens */}
              <div className="rounded-lg border bg-card overflow-hidden">
                <div className="p-3 border-b flex items-center justify-between">
                  <div className="font-semibold">Itens ({matches.length})</div>
                  <div className="text-xs text-muted-foreground">
                    {matches.filter((m) => m.product).length} de {matches.length} encontrados
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Produto da NF</TableHead>
                      <TableHead>Match no estoque</TableHead>
                      <TableHead className="w-20 text-right">Qtd</TableHead>
                      <TableHead className="w-28 text-right">Custo</TableHead>
                      <TableHead className="w-32 text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matches.map((m, idx) => (
                      <NfeRow
                        key={m.nfeItem.nItem}
                        match={m}
                        idx={idx}
                        onSearch={(q) => searchAndAttach(idx, q)}
                        onCreate={() => setCreateProductIdx(idx)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing || parsing}>
              Cancelar
            </Button>
            {step === "review" && (
              <Button onClick={importPurchase} disabled={importing || !allResolved}>
                {importing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                Importar como compra
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cria fornecedor pré-preenchido */}
      <QuickSupplierDialog
        open={createSupplierOpen}
        onOpenChange={setCreateSupplierOpen}
        initialName={nfe?.emitente.razao_social}
        onCreated={(s) => {
          setSupplier(s);
          // pré-preenche CNPJ depois (se não for igual, não faz mal — supplier criado vai usar o digitado)
        }}
      />

      {/* Cria produto novo a partir do item da NF */}
      {createProductIdx !== null && matches[createProductIdx] && (
        <QuickProductDialog
          open={createProductIdx !== null}
          onOpenChange={(o) => !o && setCreateProductIdx(null)}
          initialName={matches[createProductIdx].nfeItem.xProd}
          defaultType="suprimento"
          onCreated={(p) => {
            const i = createProductIdx;
            setMatches((arr) => arr.map((m, idx) => idx === i ? { ...m, product: p, resolved: true } : m));
            setCreateProductIdx(null);
          }}
        />
      )}
    </>
  );
}

/* ====================================================================
   ROW component (uma linha de item da NF)
==================================================================== */
function NfeRow({
  match, idx, onSearch, onCreate,
}: {
  match: ItemMatch;
  idx: number;
  onSearch: (q: string) => void;
  onCreate: () => void;
}) {
  const [searchQ, setSearchQ] = useState("");
  const it = match.nfeItem;
  const total = it.qCom * it.vUnCom;

  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-sm font-medium">{it.xProd}</span>
          <span className="text-[11px] text-muted-foreground">
            {[it.cProd && `cód ${it.cProd}`, it.cEAN && `EAN ${it.cEAN}`, `${it.qCom} ${it.uCom}`]
              .filter(Boolean).join(" · ")}
          </span>
        </div>
      </TableCell>
      <TableCell>
        {match.product ? (
          <div className="flex items-center gap-2">
            <Package className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-medium truncate">{match.product.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {[match.product.sku, match.product.barcode].filter(Boolean).join(" · ")}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30 w-fit text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" /> Não encontrado
            </Badge>
            <div className="flex gap-1">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Buscar SKU/EAN/nome"
                  className="h-7 pl-6 text-xs w-44"
                  onKeyDown={(e) => e.key === "Enter" && onSearch(searchQ)}
                />
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCreate}>
                <Plus className="h-3 w-3 mr-1" /> Cadastrar
              </Button>
            </div>
          </div>
        )}
      </TableCell>
      <TableCell className="text-right font-mono text-xs">{it.qCom}</TableCell>
      <TableCell className="text-right font-mono text-xs">{formatBRL(it.vUnCom)}</TableCell>
      <TableCell className="text-right font-mono font-medium">{formatBRL(total)}</TableCell>
    </TableRow>
  );
}
