import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import type {
  Customer,
  Sale,
  SaleItem,
  SalePayment,
} from "@/types/delvor";
import { formatBRL, formatDocument, formatPhone } from "./formatters";
import { type CompanyHeader, formatCompanyAddress } from "./companyInfo";

export interface SalePdfData {
  sale: Sale;
  customer: Customer | null;
  items: SaleItem[];
  payments: SalePayment[];
  /** Dados completos da empresa do banco (recomendado). */
  company?: CompanyHeader | null;
  /** Logo já em data URI. */
  companyLogoDataUrl?: string | null;
  /** Fallback se company não vier. */
  companyName?: string;
  sellerName?: string;
  /**
   * Modo de saída:
   *  - "download" (default): doc.save() — baixa o arquivo
   *  - "print": abre numa nova aba já com diálogo de impressão (autoPrint)
   */
  output?: "download" | "print";
}

const STATUS_LABEL: Record<string, string> = {
  orcamento: "ORÇAMENTO",
  aprovado:  "PEDIDO APROVADO",
  faturado:  "PEDIDO FATURADO",
  entregue:  "ENTREGUE",
  cancelado: "CANCELADO",
  perdido:   "PERDIDO",
};

const PAYMENT_LABEL: Record<string, string> = {
  dinheiro:           "Dinheiro",
  pix:                "PIX",
  boleto:             "Boleto",
  cartao_credito:     "Cartão crédito",
  cartao_debito:      "Cartão débito",
  credito_avista:     "Crédito à vista",
  credito_parcelado:  "Crédito parcelado",
  transferencia:      "Transferência",
  crediario:          "Crediário",
  outro:              "Outro",
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  // Bug clássico: `new Date("2026-06-10")` é parseado como UTC meia-noite,
  // e em BRT (UTC-3) vira 21h do dia 9. Por isso a data-only YYYY-MM-DD
  // vem formatada um dia antes. Pra evitar, parseio o formato direto.
  const dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) {
    return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  }
  // Datetime completo (com hora/timezone): aí o Date constructor tá ok
  return new Date(iso).toLocaleDateString("pt-BR");
}

/**
 * Gera o PDF do orçamento/pedido e dispara download no navegador.
 */
export function generateSalePdf({
  sale,
  customer,
  items,
  payments,
  company,
  companyLogoDataUrl,
  companyName,
  sellerName,
  output = "download",
}: SalePdfData) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  const cName = company?.name || companyName || "Delvor";
  const cCnpj = company?.cnpj ? formatDocument(company.cnpj) : null;
  const cPhone = company?.phone ? formatPhone(company.phone) : null;
  const cEmail = company?.email || null;
  const cAddr = company ? formatCompanyAddress(company.address) : "";

  // ---------------- HEADER ----------------
  let headerLeftX = margin;
  if (companyLogoDataUrl) {
    try {
      // Encaixa a logo numa caixa de 34x18mm preservando a proporção
      let lw = 18, lh = 18;
      try {
        const p = doc.getImageProperties(companyLogoDataUrl);
        if (p?.width && p?.height) {
          const maxW = 34, maxH = 18;
          lw = maxW; lh = maxW * (p.height / p.width);
          if (lh > maxH) { lh = maxH; lw = maxH * (p.width / p.height); }
        }
      } catch { /* sem dimensões — usa caixa quadrada padrão */ }
      doc.addImage(companyLogoDataUrl, "PNG", margin, 8, lw, lh);
      headerLeftX = margin + lw + 4;
    } catch {
      // ignora
    }
  }

  // Reserva ~55mm na direita pra Nº/Datas/etc — nome da empresa não pode invadir.
  const rightBlockWidth = 55;
  const nameMaxWidth = Math.max(40, pageWidth - headerLeftX - margin - rightBlockWidth);

  doc.setFont("helvetica", "bold");
  // Tenta tamanho 16 primeiro. Se o texto não couber, reduz progressivamente.
  let nameSize = 16;
  while (nameSize > 9 && doc.getTextWidth(cName) > nameMaxWidth) {
    nameSize -= 1;
    doc.setFontSize(nameSize);
  }
  // Se ainda não couber no menor tamanho, quebra em linhas
  doc.setFontSize(nameSize);
  const nameLines = doc.splitTextToSize(cName, nameMaxWidth) as string[];
  doc.text(nameLines, headerLeftX, 18);

  // Avança o cursor Y conforme número de linhas do nome
  let headerY = 18 + (nameLines.length - 1) * (nameSize * 0.45);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100);
  const subParts: string[] = [];
  if (cCnpj) subParts.push(`CNPJ: ${cCnpj}`);
  if (cPhone) subParts.push(`Tel: ${cPhone}`);
  if (cEmail) subParts.push(cEmail);
  if (subParts.length) {
    headerY += 5;
    const subLines = doc.splitTextToSize(subParts.join("  •  "), nameMaxWidth) as string[];
    doc.text(subLines, headerLeftX, headerY);
    headerY += (subLines.length - 1) * 4;
  }
  doc.setFontSize(10);
  headerY += 5;
  doc.text(STATUS_LABEL[sale.status] || sale.status.toUpperCase(), headerLeftX, headerY);

  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(`Nº ${String(sale.number).padStart(6, "0")}`, pageWidth - margin, 18, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(`Emissão: ${fmtDate(sale.issue_date)}`, pageWidth - margin, 24, { align: "right" });
  if (sale.delivery_date) {
    doc.text(`Entrega: ${fmtDate(sale.delivery_date)}`, pageWidth - margin, 29, { align: "right" });
  }

  // ---------------- CLIENTE ----------------
  // Começa pelo maior entre o fim do bloco esquerdo (status) e do bloco direito (datas)
  let y = Math.max(headerY + 4, sale.delivery_date ? 34 : 30, 36);
  doc.setDrawColor(220);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.text("CLIENTE", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (customer) {
    doc.text(customer.name, margin, y); y += 5;
    if (customer.trade_name) { doc.text(customer.trade_name, margin, y); y += 5; }
    const docLine: string[] = [];
    if (customer.document) docLine.push(`${customer.person_type === "PJ" ? "CNPJ" : "CPF"}: ${formatDocument(customer.document)}`);
    if (customer.phone) docLine.push(`Tel: ${formatPhone(customer.phone)}`);
    if (customer.email) docLine.push(customer.email);
    if (docLine.length) { doc.text(docLine.join("  •  "), margin, y); y += 5; }
    const addr = [
      customer.street && customer.number ? `${customer.street}, ${customer.number}` : customer.street,
      customer.complement,
      customer.district,
      customer.city && customer.state ? `${customer.city}/${customer.state}` : customer.city,
    ].filter(Boolean).join(" — ");
    if (addr) { doc.text(addr, margin, y); y += 5; }
  } else {
    doc.text("—", margin, y); y += 5;
  }

  if (sellerName) {
    y += 2;
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Vendedor: ${sellerName}`, margin, y);
    doc.setTextColor(0);
    y += 4;
  }

  // ---------------- ITENS ----------------
  y += 4;
  autoTable(doc, {
    startY: y,
    // Cabeçalhos com alinhamento explícito pra bater 100% com o corpo
    // (columnStyles.halign nem sempre aplica ao cabeçalho dependendo da versão)
    head: [[
      { content: "#",        styles: { halign: "center" } },
      { content: "Descrição", styles: { halign: "left" } },
      { content: "Qtd",      styles: { halign: "right" } },
      { content: "Unit.",    styles: { halign: "right" } },
      { content: "Desc.",    styles: { halign: "right" } },
      { content: "Total",    styles: { halign: "right" } },
    ]],
    body: items.map((it, idx) => [
      String(idx + 1),
      it.description,
      String(it.qty),
      formatBRL(it.unit_price),
      it.discount ? `- ${formatBRL(it.discount)}` : "—",
      formatBRL(it.total),
    ]),
    headStyles: { fillColor: [120, 70, 220], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 8,  halign: "center" },
      1: { cellWidth: "auto", halign: "left" },
      2: { cellWidth: 14, halign: "right" },
      3: { cellWidth: 24, halign: "right" },
      4: { cellWidth: 22, halign: "right" },
      5: { cellWidth: 28, halign: "right", fontStyle: "bold" },
    },
    margin: { left: margin, right: margin },
  });

  let afterTable = (doc as any).lastAutoTable.finalY + 6;

  // ---------------- TOTAIS ----------------
  const totalsX = pageWidth - margin - 60;
  const totalsW = 60;
  doc.setFontSize(10);

  const drawTotalRow = (label: string, value: string, bold = false, lineY?: number) => {
    const yy = lineY ?? afterTable;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(label, totalsX, yy);
    doc.text(value, totalsX + totalsW, yy, { align: "right" });
  };

  drawTotalRow("Subtotal", formatBRL(sale.subtotal));   afterTable += 5;
  if (sale.discount > 0) { drawTotalRow("Desconto", `- ${formatBRL(sale.discount)}`); afterTable += 5; }
  if (sale.freight > 0)  { drawTotalRow("Frete",    formatBRL(sale.freight));         afterTable += 5; }
  doc.setDrawColor(180);
  doc.line(totalsX, afterTable - 1, totalsX + totalsW, afterTable - 1);
  afterTable += 4;
  doc.setFontSize(12);
  drawTotalRow("TOTAL", formatBRL(sale.total), true);
  afterTable += 8;

  // ---------------- PAGAMENTOS ----------------
  if (payments.length > 0) {
    if (afterTable > 240) { doc.addPage(); afterTable = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("FORMA DE PAGAMENTO", margin, afterTable);
    afterTable += 4;
    autoTable(doc, {
      startY: afterTable,
      head: [["Método", "Vencimento", "Valor", "Status"]],
      body: payments.map((p) => [
        PAYMENT_LABEL[p.method] || p.method,
        fmtDate(p.due_date),
        formatBRL(p.amount),
        (p.status || "").toUpperCase(),
      ]),
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      margin: { left: margin, right: margin },
    });
    afterTable = (doc as any).lastAutoTable.finalY + 6;
  }

  // ---------------- OBSERVAÇÕES ----------------
  if (sale.notes) {
    if (afterTable > 250) { doc.addPage(); afterTable = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("OBSERVAÇÕES", margin, afterTable);
    afterTable += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const split = doc.splitTextToSize(sale.notes, pageWidth - margin * 2);
    doc.text(split, margin, afterTable);
  }

  // ---------------- RODAPÉ ----------------
  // Removido a pedido — endereço/empresa já aparece no cabeçalho, e os PDFs
  // não saem com paginação numerada. Se precisar voltar, é só restaurar o bloco
  // de setPage/text aqui.

  const filename = `${STATUS_LABEL[sale.status] || "VENDA"}_${String(sale.number).padStart(6, "0")}.pdf`;

  if (output === "print") {
    // autoPrint instrui o leitor PDF a abrir já no diálogo de impressão.
    // Combinado com window.open de um blob URL, dispara o print sem download manual.
    doc.autoPrint();
    const blobUrl = URL.createObjectURL(doc.output("blob"));
    const win = window.open(blobUrl, "_blank");
    if (!win) {
      // Bloqueio de popup — fallback: baixa o PDF e avisa.
      doc.save(filename);
    }
    // Libera o blob após um tempo razoável pra o leitor PDF ter pego o stream
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return;
  }

  doc.save(filename);
}
