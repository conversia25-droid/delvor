import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";

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
import { Label } from "@/components/ui/label";

interface GenerateInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  /** Sugere o mês de referência. Default = mês atual. */
  defaultReferenceMonth?: string;
  onGenerated?: (invoiceId: string) => void;
}

function firstDayOfThisMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function monthLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleString("pt-BR", { month: "long", year: "numeric" });
}

export default function GenerateInvoiceDialog({
  open, onOpenChange, contractId, defaultReferenceMonth, onGenerated,
}: GenerateInvoiceDialogProps) {
  const [refMonth, setRefMonth] = useState<string>(defaultReferenceMonth || firstDayOfThisMonth());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setRefMonth(defaultReferenceMonth || firstDayOfThisMonth());
  }, [open, defaultReferenceMonth]);

  async function generate() {
    setBusy(true);
    const { data, error } = await supabase.rpc("generate_rental_invoice" as any, {
      p_contract_id: contractId,
      p_reference_month: refMonth,
    });
    setBusy(false);
    if (error) {
      toast({
        title: "Erro ao gerar fatura",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Fatura gerada", description: monthLabel(refMonth) });
    onOpenChange(false);
    onGenerated?.(data as string);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> Gerar fatura mensal
          </DialogTitle>
          <DialogDescription>
            O sistema soma a mensalidade de cada equipamento + excedentes (com base nas leituras
            de contadores até o fim do mês de referência).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Mês de referência</Label>
            <Input type="month" value={refMonth.slice(0, 7)} onChange={(e) => setRefMonth(e.target.value + "-01")} />
            <div className="text-[11px] text-muted-foreground mt-1 capitalize">
              {monthLabel(refMonth)}
            </div>
          </div>

          <div className="rounded-md border bg-muted/20 p-3 text-xs space-y-1.5">
            <div className="font-medium text-foreground">Como o cálculo funciona:</div>
            <ul className="text-muted-foreground space-y-1 list-disc list-inside">
              <li>Cada equipamento contribui com sua mensalidade fixa</li>
              <li>Se tem franquia, busca a última leitura do mês e calcula consumo (atual − baseline)</li>
              <li>Páginas acima da franquia geram cobrança extra</li>
              <li>Vencimento da fatura usa o "dia de cobrança" do contrato no mês de referência</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={generate} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
            Gerar fatura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
